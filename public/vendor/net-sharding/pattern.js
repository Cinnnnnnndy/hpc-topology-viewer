/* ════════════════════════════════════════════════════════════════════════════
   net-sharding pattern —— 整网切分 · rank 装载
   ────────────────────────────────────────────────────────────────────────────
   回答的问题：**整网（模型计算图）被六个并行维切开之后，一个 rank 里到底装了什么。**

   逻辑魔方（rubik-cube）回答「谁和谁一组」——它的坐标系是并行超立方，卡是主体。
   本 pattern 的坐标系是**模型本身**：算子是主体，rank 是「这个算子的哪一片落在谁手里」。
   两者是同一批 p 的两种读法，互为反查（见 README 的挂点表）。

   三件事，缺一不可：
   ① 每个算子被**哪个维、沿张量的哪根轴**切开（切分规格 SHARD）；
   ② 每个 rank 因此**持有哪一片**（payloadOf：层段 / head 片 / 专家桶 / 序列块 / 上下文块 / 词表片）；
   ③ HCCL 集合原语是**分片状态的转换器**——AllGather/ReduceScatter/AllToAll/AllReduce/P2P
      各自把张量从一种分片状态搬到另一种（flowOf）。这三件事同屏，才叫「读懂整网怎么装进 rank」。

   与 graph-meta.ts 的 NODE_DIM 的关系：那份是「一个算子贴一个维」的粗标签（且无 CP/SP），
   够用来做整网图↔魔方的着色联动，但答不了「切哪根轴 / 我这张卡持有哪一片」。本 pattern
   是它的**细化**：同一张 openPangu 图，标注升级为 {维, 轴, 份数, 本 rank 持有区间}。
   ════════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const VERSION = '0.1.0';

  /* ── 维度签名色（与 rubik-cube 同一套，CP/SP 为本 pattern 新增）──────────
     TP/PP/DP/EP 沿用逻辑魔方，两个 pattern 并排看时同一维必须同一色。 */
  const DIM_META = {
    tp: { name: 'TP', full: '张量并行',   cssVar: '--ns-tp', axis: '切单层权重（head / hidden / vocab / ffn 列）' },
    cp: { name: 'CP', full: '上下文并行', cssVar: '--ns-cp', axis: '切上下文长度（seq 的 KV 段）' },
    sp: { name: 'SP', full: '序列并行',   cssVar: '--ns-sp', axis: '切序列 token（norm / dropout 区）' },
    pp: { name: 'PP', full: '流水并行',   cssVar: '--ns-pp', axis: '切模型层（stage）' },
    ep: { name: 'EP', full: '专家并行',   cssVar: '--ns-ep', axis: '切 MoE 专家（expert bank）' },
    dp: { name: 'DP', full: '数据并行',   cssVar: '--ns-dp', axis: '切数据批次（整模型复制）' },
  };
  const DIM_ORDER = ['tp', 'cp', 'sp', 'pp', 'ep', 'dp'];

  /* ── 张量轴 ──────────────────────────────────────────────────────────────
     一个张量在图里流动时，它的每根轴各自「是完整的还是被谁切了」。
     这套轴名是后面所有分片状态（state）的字母表。 */
  const AXES = {
    batch:  '批次',
    seq:    '序列 token',
    ctx:    '上下文（KV 段）',
    head:   '注意力头',
    hidden: '隐藏维',
    ffn:    'FFN 中间维',
    expert: '专家',
    vocab:  '词表',
    layer:  '模型层',
  };

  /* ══════════════════════════════════════════════════════════════════════════
     切分规格表 —— openPangu 图的 55 个节点，每个标注「被哪些维沿哪根轴切」。
     ──────────────────────────────────────────────────────────────────────────
     `by`   : [{dim, axis}]  —— 谁沿哪根轴切它；空数组 = 每个 rank 都有完整一份（复制）
     `prim` : 若本身就是 HCCL 集合原语，写它做的是哪种状态转换
     `note` : 一句话说清「为什么是这样切」（读者不该去猜）

     判据不是「这个算子长什么样」，而是**它的权重/激活的哪根轴上有可分的份数**：
     · 线性层按输出维列切 / 按输入维行切（行切的输出是 partial，必须 AllReduce 才完整）
     · norm / 逐元素 不改变特征维 → 沿 token 切最省显存，这正是 SP 的存在理由
     · MoE 专家 bank 沿 expert 轴切 → EP；token 要先 AllToAll 送到专家所在的卡
     · attention 沿 head 切 → TP；上下文太长时再沿 seq 切 → CP（算 attention 前 AllGather KV）
     ══════════════════════════════════════════════════════════════════════════ */
  const SHARD = {
    /* ── model-core：PP 的首尾两段 ───────────────────────────────────────── */
    input_tokens:   { by: [{ dim: 'dp', axis: 'batch' }, { dim: 'cp', axis: 'seq' }],
                      note: 'DP 切批次；上下文并行开启时序列先按 CP 切成段' },
    token_embedding: { by: [{ dim: 'tp', axis: 'vocab' }],
                      note: '词表并行：词表按 TP 切，查表后 AllReduce 合并（落在 PP 首段）' },
    embedding_weight: { by: [{ dim: 'tp', axis: 'vocab' }], kind: 'param',
                      note: '词表权重按 TP 切；DP 副本间由梯度 AllReduce 保持一致' },
    final_norm:     { by: [{ dim: 'sp', axis: 'seq' }],
                      note: 'RMSNorm 不改变特征维 → 沿 token 切（SP），落在 PP 末段' },
    lm_head:        { by: [{ dim: 'tp', axis: 'vocab' }],
                      note: '输出头按词表切，与 embedding 同一根轴' },
    lm_head_weight: { by: [{ dim: 'tp', axis: 'vocab' }], kind: 'param',
                      note: '输出头权重按 TP 切' },
    logits:         { by: [{ dim: 'tp', axis: 'vocab' }, { dim: 'dp', axis: 'batch' }],
                      note: '词表片上的 logits；求 loss 时跨 TP 归约' },
    mtp_module:     { by: [{ dim: 'tp', axis: 'hidden' }],
                      note: '多 token 预测头，跟随主干 TP 切分' },

    /* ── decoder-stack：PP 切层 · norm 区归 SP ──────────────────────────── */
    decoder_layer:      { by: [{ dim: 'pp', axis: 'layer' }],
                          note: '整个解码层是 PP 的切分单位：每个 stage 持有连续若干层' },
    mhc_attention:      { by: [{ dim: 'tp', axis: 'head' }], note: 'mHC 注意力分支，随 TP 切 head' },
    mhc_attention_post: { by: [{ dim: 'tp', axis: 'head' }], note: 'mHC 合并，随 TP 切 head' },
    input_layernorm:    { by: [{ dim: 'sp', axis: 'seq' }],  note: '进入 TP 区之前的 norm → SP 沿 token 切' },
    post_attention_norm:{ by: [{ dim: 'sp', axis: 'seq' }],  note: '出 TP 区之后的 norm → SP' },
    pre_mlp_norm:       { by: [{ dim: 'sp', axis: 'seq' }],  note: '进 FFN 之前的 norm → SP' },
    post_mlp_norm:      { by: [{ dim: 'sp', axis: 'seq' }],  note: '出 FFN 之后的 norm → SP' },
    block_post_norm:    { by: [{ dim: 'sp', axis: 'seq' }],  note: '块尾 norm → SP' },

    /* ── attention-block：TP + CP + SP ──────────────────────────────────── */
    sparse_mla_attention: { by: [{ dim: 'tp', axis: 'head' }], note: 'MLA 注意力整体按 head 切' },
    q_a_proj:  { by: [{ dim: 'tp', axis: 'hidden' }], note: 'Q 降维投影：列切（输出 latent 维）' },
    q_causal_conv: { by: [{ dim: 'tp', axis: 'hidden' }], note: '逐通道卷积，跟随上游列切，无通信' },
    q_residual_add:{ by: [{ dim: 'tp', axis: 'hidden' }], note: '逐元素相加，跟随分片' },
    q_a_norm:  { by: [{ dim: 'tp', axis: 'hidden' }], note: 'latent 上的 norm，跟随 TP 分片' },
    q_b_proj:  { by: [{ dim: 'tp', axis: 'head' }],   note: 'Q 升维：输出按注意力头切 → 每 rank 持有部分 head' },
    kv_a_proj: { by: [{ dim: 'tp', axis: 'hidden' }], note: 'KV 降维投影：列切' },
    kv_causal_conv:{ by: [{ dim: 'tp', axis: 'hidden' }], note: '逐通道卷积，跟随分片' },
    kv_residual_add:{ by: [{ dim: 'tp', axis: 'hidden' }], note: '逐元素相加，跟随分片' },
    kv_a_norm: { by: [{ dim: 'tp', axis: 'hidden' }], note: 'latent norm，跟随分片' },
    kv_b_proj: { by: [{ dim: 'tp', axis: 'head' }],   note: 'KV 升维：输出按 head 切' },
    query_tensor: { by: [{ dim: 'tp', axis: 'head' }, { dim: 'cp', axis: 'ctx' }], kind: 'tensor',
                    note: 'Q：head 归 TP；上下文并行时 seq 段归 CP' },
    key_tensor:   { by: [{ dim: 'tp', axis: 'head' }, { dim: 'cp', axis: 'ctx' }], kind: 'tensor',
                    note: 'K：算 attention 前需在 CP 组内 AllGather 出完整上下文' },
    value_tensor: { by: [{ dim: 'tp', axis: 'head' }, { dim: 'cp', axis: 'ctx' }], kind: 'tensor',
                    note: 'V：同 K，CP 组内 AllGather' },
    attention_core: { by: [{ dim: 'tp', axis: 'head' }, { dim: 'cp', axis: 'ctx' }],
                    note: '每 rank 只算自己那几个 head；CP 开启时只算本地 token 对全局上下文的注意力' },
    o_causal_conv:  { by: [{ dim: 'tp', axis: 'head' }], note: '输出侧卷积，跟随 head 分片' },
    o_residual_add: { by: [{ dim: 'tp', axis: 'head' }], note: '逐元素，跟随分片' },
    o_proj:    { by: [{ dim: 'tp', axis: 'hidden' }], partial: true,
                 note: '输出投影：行切 → 每 rank 得到的是 partial sum，必须归约才完整' },
    attention_projection_weights: { by: [{ dim: 'tp', axis: 'head' }], kind: 'param',
                 note: 'QKVO 投影权重按 head/hidden 切，是 TP 组内 AllReduce 的对象' },

    /* ── ffn-block：TP（dense）+ EP（MoE）+ SP ──────────────────────────── */
    dense_mlp:       { by: [{ dim: 'tp', axis: 'ffn' }], note: 'Dense FFN 整体按中间维切' },
    dense_gate_up:   { by: [{ dim: 'tp', axis: 'ffn' }], note: '列并行：gate/up 输出按 FFN 中间维切' },
    dense_silu:      { by: [{ dim: 'tp', axis: 'ffn' }], note: 'SiLU 逐元素，跟随列切，无通信' },
    dense_down:      { by: [{ dim: 'tp', axis: 'hidden' }], partial: true,
                       note: '行并行：down 投影输出是 partial sum，需归约' },
    dense_mlp_weights: { by: [{ dim: 'tp', axis: 'ffn' }], kind: 'param', note: 'Dense FFN 权重按中间维切' },

    /* ── moe-block：EP 是主角 ───────────────────────────────────────────── */
    router_gate:  { by: [], note: '路由门是复制的：每 rank 都要独立算出 token 该去哪个专家' },
    router_weight:{ by: [], kind: 'param', note: '路由权重复制（很小），由 DP 梯度同步保持一致' },
    route_topk:   { by: [], note: 'TopK 选专家，复制计算 —— 之后才谈得上把 token 送出去' },
    routed_expert_bank: { by: [{ dim: 'ep', axis: 'expert' }],
                    note: '路由专家 bank 按专家切：每 rank 只持有自己那一桶专家的权重' },
    expert_bank_weights:{ by: [{ dim: 'ep', axis: 'expert' }], kind: 'param',
                    note: '专家权重按 EP 切 —— MoE 显存不爆的根本原因' },
    expert_parallel_state: { by: [{ dim: 'ep', axis: 'expert' }], kind: 'tensor',
                    note: '专家并行运行态：本 rank 这一桶专家的负载/容量' },
    shared_expert_mlp:  { by: [{ dim: 'tp', axis: 'ffn' }],
                    note: '共享专家每个 rank 都有（不按 EP 切），内部按 TP 切中间维' },
    shared_expert_weights: { by: [{ dim: 'tp', axis: 'ffn' }], kind: 'param',
                    note: '共享专家权重按 TP 切，不参与 EP' },
    moe_combine:  { by: [{ dim: 'tp', axis: 'hidden' }], note: '按路由权重加权合并专家输出' },

    /* ── 集合通信算子 = 分片状态的转换器 ────────────────────────────────── */
    attention_all_gather: { by: [], prim: 'AllGather', group: 'tp',
        from: { seq: 'sp' }, to: { seq: null },
        note: 'SP→TP 区入口：把沿 token 切开的激活在 TP 组内收齐成完整序列' },
    attention_reduce_scatter: { by: [], prim: 'ReduceScatter', group: 'tp',
        from: { hidden: 'partial' }, to: { seq: 'sp' },
        note: 'TP 区出口：把 partial sum 归约的同时沿 token 散开 —— 一步顶 AllReduce+Scatter' },
    ffn_all_gather: { by: [], prim: 'AllGather', group: 'tp',
        from: { seq: 'sp' }, to: { seq: null },
        note: '进 FFN 前同样要收齐完整序列' },
    ffn_reduce_scatter: { by: [], prim: 'ReduceScatter', group: 'tp',
        from: { hidden: 'partial' }, to: { seq: 'sp' },
        note: '出 FFN 时归约 + 沿 token 散开，回到 SP 状态' },
    moe_all_to_all_dispatch: { by: [], prim: 'AllToAll', group: 'ep',
        from: { seq: 'local' }, to: { expert: 'ep' },
        note: 'EP 的核心：token 按路由结果重分布到专家所在的 rank —— 从「按 token 分」变成「按专家分」' },
    moe_all_to_all_combine: { by: [], prim: 'AllToAll', group: 'ep',
        from: { expert: 'ep' }, to: { seq: 'local' },
        note: '专家算完把结果送回 token 原属的 rank —— dispatch 的逆转换' },
  };

  /* ══════════════════════════════════════════════════════════════════════════
     createModel —— 纯数据层，无 DOM / 无渲染依赖（可单测、可被别的视图复用）
     ══════════════════════════════════════════════════════════════════════════ */
  function createModel(cfgIn) {
    const c = Object.assign({
      tp: 8, pp: 5, dp: 100, ep: 2, cp: 1,
      layers: 48, heads: 64, experts: 64, sharedExperts: 4,
      seqLen: 4096, hidden: 5120, ffnHidden: 14336, vocab: 153376,
    }, cfgIn || {});

    const TP = Math.max(1, c.tp | 0), CP = Math.max(1, c.cp | 0);
    const PP = Math.max(1, c.pp | 0), DP = Math.max(1, c.dp | 0);
    const EP = Math.max(1, c.ep | 0);
    /* SP 不是独立的 rank 维：序列并行复用 TP 组（Megatron 口径，与 data.ts 的
       「SP 与 TP 同域」一致）。所以 rank 总数只乘 TP·CP·PP·DP。 */
    const SP = TP;
    const N = TP * CP * PP * DP;

    /* rank 分解：TP 最内 → CP → PP → DP 最外。
       CP=1 时与仓库现有约定（tp=k%TP · stage · replica）逐位相同，是它的推广。 */
    function coordOf(rank) {
      const k = ((rank % N) + N) % N;
      const tp = k % TP;
      const cp = Math.floor(k / TP) % CP;
      const pp = Math.floor(k / (TP * CP)) % PP;
      const dp = Math.floor(k / (TP * CP * PP));
      return { rank: k, tp, cp, pp, dp, ep: dp % EP, sp: tp };
    }
    function rankOf(co) {
      const tp = (co.tp | 0) % TP, cp = (co.cp | 0) % CP;
      const pp = (co.pp | 0) % PP, dp = (co.dp | 0) % DP;
      return ((dp * PP + pp) * CP + cp) * TP + tp;
    }

    /* 层段：余数摊给前面的 stage（与 deployment.ts stageLayerRange 同口径） */
    function stageLayers(stage) {
      const base = Math.floor(c.layers / PP), rem = c.layers % PP;
      const lo = stage * base + Math.min(stage, rem);
      const hi = lo + base + (stage < rem ? 1 : 0) - 1;
      return [lo, Math.max(lo, hi)];
    }
    /* 等分某根轴（不能整除时前面的片多拿一个），返回 [lo, hi] 闭区间 */
    function slice(total, parts, idx) {
      const base = Math.floor(total / parts), rem = total % parts;
      const lo = idx * base + Math.min(idx, rem);
      const hi = lo + base + (idx < rem ? 1 : 0) - 1;
      return [lo, Math.max(lo, hi)];
    }

    /* HCCL 通信域成员：固定其余坐标，只让这一维跑遍 */
    function groupOf(rank, dim, cap) {
      const co = coordOf(rank), out = [];
      const lim = cap == null ? Infinity : cap;
      if (dim === 'tp' || dim === 'sp') {
        for (let i = 0; i < TP && out.length < lim; i++) out.push(rankOf({ ...co, tp: i }));
      } else if (dim === 'cp') {
        for (let i = 0; i < CP && out.length < lim; i++) out.push(rankOf({ ...co, cp: i }));
      } else if (dim === 'pp') {
        for (let i = 0; i < PP && out.length < lim; i++) out.push(rankOf({ ...co, pp: i }));
      } else if (dim === 'dp') {
        for (let i = 0; i < DP && out.length < lim; i++) out.push(rankOf({ ...co, dp: i }));
      } else if (dim === 'ep') {
        /* EP 折入 DP 轴：相邻 EP 个副本构成一个 A2A 域 */
        const blk = Math.floor(co.dp / EP) * EP;
        for (let i = 0; i < EP && out.length < lim; i++) out.push(rankOf({ ...co, dp: blk + i }));
      }
      return out;
    }

    /* ── 本 rank 到底装了什么 ───────────────────────────────────────────── */
    function payloadOf(rank) {
      const co = coordOf(rank);
      const [l0, l1] = stageLayers(co.pp);
      const heads = slice(c.heads, TP, co.tp);
      const vocab = slice(c.vocab, TP, co.tp);
      const ffn = slice(c.ffnHidden, TP, co.tp);
      const experts = slice(c.experts, EP, co.ep);
      const ctx = slice(c.seqLen, CP, co.cp);
      /* SP 在 CP 段之内再按 TP 切一次（norm 区的 token 分片） */
      const cpLen = ctx[1] - ctx[0] + 1;
      const spRel = slice(cpLen, SP, co.sp);
      const spTok = [ctx[0] + spRel[0], ctx[0] + spRel[1]];
      return {
        rank: co.rank, coord: co,
        layers: [l0, l1], layerCount: l1 - l0 + 1,
        heads, headCount: heads[1] - heads[0] + 1,
        experts, expertCount: experts[1] - experts[0] + 1,
        sharedExperts: c.sharedExperts,       // 共享专家不按 EP 切，每 rank 都有
        ctx, ctxCount: ctx[1] - ctx[0] + 1,
        spTokens: spTok, spCount: spTok[1] - spTok[0] + 1,
        vocab, vocabCount: vocab[1] - vocab[0] + 1,
        ffn, ffnCount: ffn[1] - ffn[0] + 1,
        isFirstStage: co.pp === 0, isLastStage: co.pp === PP - 1,
      };
    }

    /* 某个算子在本 rank 上持有哪一片（拿切分规格 × payload 求交） */
    function shardOfNode(nodeId, rank) {
      const spec = SHARD[nodeId];
      if (!spec) return null;
      const p = payloadOf(rank), parts = [];
      (spec.by || []).forEach((b) => {
        const dm = DIM_META[b.dim];
        let range = null, total = null;
        if (b.axis === 'head') { range = p.heads; total = c.heads; }
        else if (b.axis === 'expert') { range = p.experts; total = c.experts; }
        else if (b.axis === 'layer') { range = p.layers; total = c.layers; }
        else if (b.axis === 'vocab') { range = p.vocab; total = c.vocab; }
        else if (b.axis === 'ffn') { range = p.ffn; total = c.ffnHidden; }
        else if (b.axis === 'ctx') { range = p.ctx; total = c.seqLen; }
        else if (b.axis === 'seq') { range = p.spTokens; total = c.seqLen; }
        else if (b.axis === 'hidden') { range = slice(c.hidden, TP, p.coord.tp); total = c.hidden; }
        else if (b.axis === 'batch') { range = null; total = null; }
        parts.push({ dim: b.dim, dimName: dm ? dm.name : b.dim, axis: b.axis,
                     axisName: AXES[b.axis] || b.axis, range, total });
      });
      return { nodeId, spec, parts, replicated: parts.length === 0, partial: !!spec.partial };
    }

    /* ── 一个 decoder layer 内的分片状态流水 ────────────────────────────────
       这是「输入输出 × attention/MoE × HCCL 算子」三者关系的正面回答：
       每一步给出**此刻张量处于什么分片状态**，以及**是哪个集合原语把它搬过去的**。 */
    function flowOf() {
      const steps = [];
      const push = (o) => steps.push(o);
      push({ id: 'input_layernorm', label: 'Input RMSNorm', kind: 'op', dim: 'sp',
             state: `seq 切 SP×${SP}`, why: 'norm 不改变特征维 → 沿 token 切最省显存' });
      push({ id: 'attention_all_gather', label: 'AllGather', kind: 'comm', dim: 'tp', prim: 'AllGather',
             state: 'seq 完整', why: '进 TP 区前把序列收齐（TP 组内）' });
      push({ id: 'q_b_proj', label: 'QKV 投影', kind: 'op', dim: 'tp',
             state: `head 切 TP×${TP}`, why: '注意力头按 TP 切，每 rank 只持有部分 head' });
      if (CP > 1) {
        push({ id: 'key_tensor', label: 'CP AllGather(KV)', kind: 'comm', dim: 'cp', prim: 'AllGather',
               state: 'ctx 完整', why: `上下文按 CP×${CP} 切开，算 attention 前在 CP 组内收齐 KV` });
      }
      push({ id: 'attention_core', label: 'FlashAttention', kind: 'op', dim: 'tp',
             state: `head 切 TP×${TP}${CP > 1 ? ` · ctx 切 CP×${CP}` : ''}`,
             why: '只算自己那几个 head' });
      push({ id: 'o_proj', label: 'Output Proj（行切）', kind: 'op', dim: 'tp', partial: true,
             state: 'hidden partial', why: '行并行的输出是部分和，必须归约' });
      push({ id: 'attention_reduce_scatter', label: 'ReduceScatter', kind: 'comm', dim: 'tp', prim: 'ReduceScatter',
             state: `seq 切 SP×${SP}`, why: '归约 partial 的同时沿 token 散开，回到 SP' });
      push({ id: 'pre_mlp_norm', label: 'Pre MLP RMSNorm', kind: 'op', dim: 'sp',
             state: `seq 切 SP×${SP}`, why: '又一个 norm → SP 区' });
      push({ id: 'ffn_all_gather', label: 'AllGather', kind: 'comm', dim: 'tp', prim: 'AllGather',
             state: 'seq 完整', why: '进 FFN 前收齐序列' });
      push({ id: 'route_topk', label: 'Router TopK', kind: 'op', dim: null,
             state: '复制', why: '每 rank 都独立算 token 该去哪个专家' });
      push({ id: 'moe_all_to_all_dispatch', label: 'AllToAll Dispatch', kind: 'comm', dim: 'ep', prim: 'AllToAll',
             state: `expert 切 EP×${EP}`, why: 'token 重分布到专家所在的 rank：从「按 token 分」变「按专家分」' });
      push({ id: 'routed_expert_bank', label: '路由专家计算', kind: 'op', dim: 'ep',
             state: `expert 切 EP×${EP}`, why: `每 rank 只持有 ${Math.ceil(c.experts / EP)} 个专家的权重` });
      push({ id: 'moe_all_to_all_combine', label: 'AllToAll Combine', kind: 'comm', dim: 'ep', prim: 'AllToAll',
             state: 'token 归位', why: '结果送回 token 原属的 rank（dispatch 的逆）' });
      push({ id: 'ffn_reduce_scatter', label: 'ReduceScatter', kind: 'comm', dim: 'tp', prim: 'ReduceScatter',
             state: `seq 切 SP×${SP}`, why: '出 FFN 归约 + 散开' });
      push({ id: 'post_mlp_norm', label: 'Post MLP RMSNorm', kind: 'op', dim: 'sp',
             state: `seq 切 SP×${SP}`, why: '块尾 norm' });
      if (PP > 1) {
        push({ id: '__pp_send', label: 'P2P Send → 下一 stage', kind: 'comm', dim: 'pp', prim: 'P2P',
               state: '激活出栈', why: `PP×${PP} 段之间只传激活，通信量最小` });
      }
      return steps;
    }

    /* 反查：某个维切了哪些算子（整网图高亮用） */
    const dimNodes = { tp: [], cp: [], sp: [], pp: [], dp: [], ep: [] };
    Object.keys(SHARD).forEach((id) => {
      const s = SHARD[id];
      (s.by || []).forEach((b) => { if (dimNodes[b.dim]) dimNodes[b.dim].push(id); });
      if (s.group && dimNodes[s.group] && dimNodes[s.group].indexOf(id) < 0) dimNodes[s.group].push(id);
    });

    /* 某算子的主导维（一个算子可能被多维切，取最内层那个作为着色依据） */
    function primaryDim(nodeId) {
      const s = SHARD[nodeId];
      if (!s) return null;
      if (s.group) return s.group;
      if (!s.by || !s.by.length) return null;
      const rank_ = { tp: 0, cp: 1, sp: 2, ep: 3, pp: 4, dp: 5 };
      return s.by.slice().sort((a, b) => rank_[a.dim] - rank_[b.dim])[0].dim;
    }

    return {
      config: c, N, sizes: { TP, CP, SP, PP, DP, EP },
      coordOf, rankOf, payloadOf, shardOfNode, groupOf, stageLayers, slice,
      flowOf, primaryDim, dimNodes, SHARD, DIM_META, AXES,
    };
  }

  /* ══════════════════════════════════════════════════════════════════════════
     mount —— 渲染层
     布局：顶栏（并行度 / rank 选择） · 左=整网图 · 右=rank 装载卡 · 底=分片状态流水
     ══════════════════════════════════════════════════════════════════════════ */
  function mount(container, opts) {
    opts = opts || {};
    const el = typeof container === 'string' ? document.querySelector(container) : container;
    if (!el) throw new Error('[net-sharding] container not found');

    let model = createModel(opts.config);
    let theme = opts.theme === 'dark' ? 'dark' : 'light';
    let selRank = opts.rank != null ? opts.rank : Math.floor(model.N / 2);
    let selNode = opts.node || null;
    let hiDim = opts.dim || null;          // 高亮某一维切的算子
    let graphCtrl = null;

    el.classList.add('ns-root');
    el.innerHTML = '';

    /* ── 顶栏 ── */
    const bar = document.createElement('div');
    bar.className = 'ns-bar';
    el.appendChild(bar);

    /* ── 主体 ── */
    const main = document.createElement('div');
    main.className = 'ns-main';
    el.appendChild(main);

    const graphWrap = document.createElement('div');
    /* `pto-model-graphviz-pattern-page` 不是装饰类：model-graphviz 的 pattern.css 把
       节点填色/线色等一整套 CSS 变量都作用域在这个类下（`.pto-model-graphviz-pattern-page{--model-graphviz-*}`）。
       不挂它，张量节点的 `--model-graphviz-tensor-fill` 解析不出来，整排权重/张量框会渲染成近黑色、字读不出。 */
    graphWrap.className = 'ns-graph pto-model-graphviz-pattern-page';
    main.appendChild(graphWrap);

    const side = document.createElement('div');
    side.className = 'ns-side';
    main.appendChild(side);

    const flowBand = document.createElement('div');
    flowBand.className = 'ns-flow';
    el.appendChild(flowBand);

    /* ── 顶栏内容 ── */
    function buildBar() {
      const s = model.sizes;
      bar.innerHTML = '';
      const title = document.createElement('div');
      title.className = 'ns-title';
      title.innerHTML = '<b>整网切分 · rank 装载</b><span class="ns-sub">算子怎么切 → 这张卡装了什么</span>';
      bar.appendChild(title);

      const cfgRow = document.createElement('div');
      cfgRow.className = 'ns-ctl';
      const mk = (key, label, val) => {
        const w = document.createElement('label');
        w.className = 'ns-num';
        w.innerHTML = `<span>${label}</span>`;
        const i = document.createElement('input');
        i.type = 'number'; i.min = '1'; i.value = val; i.dataset.key = key;
        i.addEventListener('change', applyCfg);
        i.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyCfg(); });
        w.appendChild(i);
        return w;
      };
      cfgRow.appendChild(mk('tp', 'TP', s.TP));
      cfgRow.appendChild(mk('cp', 'CP', s.CP));
      cfgRow.appendChild(mk('pp', 'PP', s.PP));
      cfgRow.appendChild(mk('ep', 'EP', s.EP));
      cfgRow.appendChild(mk('dp', 'DP', s.DP));

      const rk = document.createElement('label');
      rk.className = 'ns-num ns-rank';
      rk.innerHTML = '<span>rank</span>';
      const ri = document.createElement('input');
      ri.type = 'number'; ri.min = '0'; ri.max = String(model.N - 1); ri.value = String(selRank);
      ri.id = 'ns-rank-input';
      ri.addEventListener('change', () => { setRank(+ri.value); });
      rk.appendChild(ri);
      cfgRow.appendChild(rk);

      const tot = document.createElement('span');
      tot.className = 'ns-chip';
      tot.textContent = `${s.TP}×${s.CP}×${s.PP}×${s.DP} = ${model.N} rank`;
      tot.title = 'SP 复用 TP 组、EP 折入 DP 轴，故不进乘法';
      cfgRow.appendChild(tot);
      bar.appendChild(cfgRow);

      /* 维度高亮开关：点一个维 → 整网图上被它切的算子亮起 */
      const dimRow = document.createElement('div');
      dimRow.className = 'ns-dims';
      DIM_ORDER.forEach((d) => {
        const b = document.createElement('button');
        b.className = 'ns-dimbtn' + (hiDim === d ? ' is-on' : '');
        b.dataset.dim = d;
        b.style.setProperty('--c', `var(${DIM_META[d].cssVar})`);
        b.innerHTML = `<i></i>${DIM_META[d].name}`;
        b.title = `${DIM_META[d].full} · ${DIM_META[d].axis}`;
        b.onclick = () => { hiDim = (hiDim === d ? null : d); buildBar(); applyGraphDim(); };
        dimRow.appendChild(b);
      });
      bar.appendChild(dimRow);

      const slot = document.createElement('div');
      slot.className = 'ns-toolslot';
      bar.appendChild(slot);
    }

    function applyCfg() {
      const next = {};
      bar.querySelectorAll('input[data-key]').forEach((i) => { next[i.dataset.key] = Math.max(1, +i.value || 1); });
      const cfg = Object.assign({}, model.config, next);
      if (cfg.dp % cfg.ep !== 0) { flash('EP 必须整除 DP'); buildBar(); return; }
      const total = cfg.tp * cfg.cp * cfg.pp * cfg.dp;
      if (total > 65536) { flash('rank 总数超过 65536'); buildBar(); return; }
      model = createModel(cfg);
      if (selRank >= model.N) selRank = model.N - 1;
      buildBar(); renderSide(); renderFlow(); applyGraphDim();
    }

    let flashT = null;
    function flash(msg) {
      let f = el.querySelector('.ns-flash');
      if (!f) { f = document.createElement('div'); f.className = 'ns-flash'; el.appendChild(f); }
      f.textContent = msg; f.classList.add('is-on');
      clearTimeout(flashT);
      flashT = setTimeout(() => f.classList.remove('is-on'), 2200);
    }

    /* ── 整网图 ── */
    function buildGraph() {
      const G = global.OPENPANGU_GRAPH;
      const P = global.PtoModelGraphvizPattern;
      if (!G || !P) {
        graphWrap.innerHTML = '<div class="ns-empty">整网图资源未加载<br><small>需要 vendor/model-graphviz/graph.js + pattern.js</small></div>';
        return;
      }
      graphWrap.innerHTML = '';
      const stage = document.createElement('div');
      stage.className = 'ns-graph-stage';
      graphWrap.appendChild(stage);
      const colormap = (theme === 'light' && P.modelArchitectureColormap)
        ? P.modelArchitectureColormap(G, { theme: 'light', lightHsl: { hue: 2, saturation: 79, lightness: 76 } })
        : undefined;
      graphCtrl = P.renderController(stage, G, {
        theme, colormap, reportOverlays: false, evidence: false,
        onSelect: (info) => {
          const id = (info && info.nodeId) || null;
          selNode = id;
          renderSide();
          if (opts.onSelectNode) opts.onSelectNode(id, id ? model.primaryDim(id) : null);
        },
      });
      if (graphCtrl && graphCtrl.svg) {
        graphCtrl.svg.style.width = '100%';
        graphCtrl.svg.style.height = 'auto';
        graphCtrl.svg.style.display = 'block';
        /* 静态定位图：收起手柄不会重排，藏掉避免右缘一排无效小点（同 WholeNetGraph） */
        graphCtrl.svg.querySelectorAll('.pto-model-graphviz-toggle, .pto-model-graphviz-toggle-icon')
          .forEach((n) => { n.style.display = 'none'; });
        decorateGraph();
        applyGraphDim();
      }
    }

    /* 给每个被切的算子打上维度签名边框（切分规格直接画在图上） */
    function decorateGraph() {
      if (!graphCtrl || !graphCtrl.svg) return;
      graphCtrl.svg.querySelectorAll('[data-node-id]').forEach((n) => {
        const id = n.getAttribute('data-node-id');
        const d = model.primaryDim(id);
        n.classList.toggle('ns-has-shard', !!d);
        if (d) n.setAttribute('data-ns-dim', d); else n.removeAttribute('data-ns-dim');
        const spec = model.SHARD[id];
        if (spec && spec.prim) n.setAttribute('data-ns-prim', spec.prim);
      });
    }

    function applyGraphDim() {
      if (!graphCtrl || !graphCtrl.svg) return;
      const svg = graphCtrl.svg;
      svg.setAttribute('data-ns-hi', hiDim || '');
      const set = hiDim ? new Set(model.dimNodes[hiDim] || []) : null;
      svg.querySelectorAll('[data-node-id]').forEach((n) => {
        const id = n.getAttribute('data-node-id');
        n.classList.toggle('ns-dim-off', !!set && !set.has(id));
        n.classList.toggle('ns-dim-on', !!set && set.has(id));
      });
    }

    /* ── 右侧：rank 装载卡 ── */
    function renderSide() {
      const p = model.payloadOf(selRank);
      const co = p.coord, s = model.sizes, cfg = model.config;
      const row = (k, v, tone) => `<div class="ns-kv${tone ? ' is-' + tone : ''}"><span>${k}</span><b>${v}</b></div>`;
      const rng = (r, unit) => r[0] === r[1] ? `${r[0]}` : `${r[0]}–${r[1]}`;

      let html = '';
      html += `<div class="ns-card">
        <div class="ns-kicker">RANK</div>
        <div class="ns-h">rank ${p.rank} <small>/ ${model.N}</small></div>
        <div class="ns-lede">整网被六维切开之后，落在这张卡上的那一份。</div>
        <div class="ns-coord">
          ${DIM_ORDER.map((d) => `<span class="ns-cc" style="--c:var(${DIM_META[d].cssVar})">
             <i>${DIM_META[d].name}</i>${d === 'sp' ? co.tp : co[d]}</span>`).join('')}
        </div>
      </div>`;

      html += `<div class="ns-card">
        <div class="ns-kicker">这张卡持有什么</div>
        ${row('模型层（PP）', `L${p.layers[0]}–L${p.layers[1]} · 共 ${p.layerCount} 层`, 'pp')}
        ${row('注意力头（TP）', `h${rng(p.heads)} · ${p.headCount}/${cfg.heads}`, 'tp')}
        ${row('FFN 中间维（TP）', `${p.ffnCount} / ${cfg.ffnHidden}`, 'tp')}
        ${row('词表片（TP）', p.isFirstStage || p.isLastStage ? `${rng(p.vocab)} · ${p.vocabCount}` : '—（非首末段）', 'tp')}
        ${row('路由专家（EP）', `E${rng(p.experts)} · ${p.expertCount}/${cfg.experts}`, 'ep')}
        ${row('共享专家', `${p.sharedExperts} 个（每 rank 都有，不按 EP 切）`, '')}
        ${row('上下文段（CP）', s.CP > 1 ? `tok ${rng(p.ctx)} · ${p.ctxCount}` : `全序列 ${cfg.seqLen}（CP=1）`, 'cp')}
        ${row('序列片（SP）', `tok ${rng(p.spTokens)} · ${p.spCount}（norm 区）`, 'sp')}
        ${row('数据副本（DP）', `副本 ${co.dp} / ${s.DP}`, 'dp')}
      </div>`;

      html += `<div class="ns-card">
        <div class="ns-kicker">HCCL 通信域</div>
        <div class="ns-lede">这张卡同时属于这几个 communicator。</div>
        ${DIM_ORDER.filter((d) => d !== 'sp').map((d) => {
          const g = model.groupOf(selRank, d, 9);
          const size = d === 'tp' ? s.TP : d === 'cp' ? s.CP : d === 'pp' ? s.PP : d === 'ep' ? s.EP : s.DP;
          const prim = d === 'tp' ? 'AllReduce / AllGather / ReduceScatter'
                     : d === 'cp' ? 'AllGather(KV)' : d === 'pp' ? 'P2P Send/Recv'
                     : d === 'ep' ? 'AllToAll' : 'AllReduce（梯度）';
          return `<div class="ns-grp" style="--c:var(${DIM_META[d].cssVar})">
            <div class="ns-grp-h"><i></i><b>${DIM_META[d].name}</b><span>×${size}</span><em>${prim}</em></div>
            <div class="ns-grp-m">${g.map((r) => `<u class="${r === selRank ? 'is-me' : ''}">${r}</u>`).join('')}${size > g.length ? '<u class="is-more">…</u>' : ''}</div>
          </div>`;
        }).join('')}
      </div>`;

      /* 选中算子 → 它在本 rank 上的那一片 */
      if (selNode) {
        const sh = model.shardOfNode(selNode, selRank);
        if (sh) {
          const spec = sh.spec;
          html += `<div class="ns-card is-node">
            <div class="ns-kicker">选中算子</div>
            <div class="ns-h2">${selNode}</div>
            ${spec.prim ? `<div class="ns-prim">${spec.prim}<small>${spec.group ? ' · ' + DIM_META[spec.group].name + ' 组内' : ''}</small></div>` : ''}
            <div class="ns-lede">${spec.note || ''}</div>
            ${sh.replicated
              ? `<div class="ns-kv is-none"><span>切分</span><b>复制 —— 每 rank 各一份完整的</b></div>`
              : sh.parts.map((pt) => `<div class="ns-kv is-${pt.dim}">
                   <span>${pt.dimName} 沿 ${pt.axisName}</span>
                   <b>${pt.range ? (pt.range[0] === pt.range[1] ? pt.range[0] : pt.range[0] + '–' + pt.range[1]) : '按批次'}${pt.total ? ` / ${pt.total}` : ''}</b></div>`).join('')}
            ${sh.partial ? `<div class="ns-warn">行并行输出 = partial sum，必须经 TP 组归约才完整</div>` : ''}
          </div>`;
        }
      } else {
        html += `<div class="ns-card is-hint">点整网图上任意算子 → 这里显示它被怎么切、本 rank 持有哪一片。</div>`;
      }

      side.innerHTML = html;
      const ri = bar.querySelector('#ns-rank-input');
      if (ri && +ri.value !== selRank) ri.value = String(selRank);
    }

    /* ── 底部：分片状态流水 ── */
    function renderFlow() {
      const steps = model.flowOf();
      flowBand.innerHTML = `<div class="ns-flow-h">
          <b>一个 decoder layer 内的分片状态流水</b>
          <span>HCCL 集合原语 = 分片状态的转换器 · 悬停看为什么</span>
        </div>
        <div class="ns-flow-track">${steps.map((st) => {
          const c = st.dim ? `var(${DIM_META[st.dim].cssVar})` : 'var(--ns-neutral)';
          return `<div class="ns-step ${st.kind === 'comm' ? 'is-comm' : 'is-op'}" style="--c:${c}" title="${st.why}">
            <div class="ns-step-t">${st.label}</div>
            <div class="ns-step-s">${st.state}</div>
            ${st.prim ? `<div class="ns-step-p">${st.prim}</div>` : ''}
          </div>`;
        }).join('<div class="ns-arrow">›</div>')}</div>`;
    }

    function setRank(r) {
      if (!isFinite(r)) return;
      selRank = Math.max(0, Math.min(model.N - 1, Math.floor(r)));
      renderSide();
      if (opts.onSelectRank) opts.onSelectRank(selRank, model.payloadOf(selRank));
    }

    function setTheme(t) {
      theme = t === 'dark' ? 'dark' : 'light';
      el.setAttribute('data-theme', theme);
      buildGraph();
    }

    el.setAttribute('data-theme', theme);
    buildBar(); buildGraph(); renderSide(); renderFlow();

    return {
      get model() { return model; },
      get state() { return { rank: selRank, node: selNode, dim: hiDim, theme }; },
      setConfig(cfg) {
        const c2 = Object.assign({}, model.config, cfg);
        if (c2.dp % c2.ep !== 0) return { ok: false, error: 'ep 必须整除 dp' };
        if (c2.tp * c2.cp * c2.pp * c2.dp > 65536) return { ok: false, error: 'rank 超过 65536' };
        model = createModel(c2);
        if (selRank >= model.N) selRank = model.N - 1;
        buildBar(); renderSide(); renderFlow(); applyGraphDim();
        return { ok: true };
      },
      selectRank: setRank,
      selectNode(id) { selNode = id; if (graphCtrl && id) graphCtrl.selectNode(id, { source: 'api' }); renderSide(); },
      highlightDim(d) { hiDim = d || null; buildBar(); applyGraphDim(); },
      setTheme,
      toolSlot() { return bar.querySelector('.ns-toolslot'); },
      destroy() { if (graphCtrl && graphCtrl.destroy) graphCtrl.destroy(); el.innerHTML = ''; },
    };
  }

  global.PtoNetShardingPattern = { createModel, mount, VERSION, SHARD, DIM_META, AXES };
})(window);
