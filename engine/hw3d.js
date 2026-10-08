/*! © 2026 王欣迪 (Cindy_wxd) · SPDX-License-Identifier: Apache-2.0 · 使用、修改或再分发须保留本署名与 NOTICE */
/* 集群 2.5D / 3D —— 平面图的同一张图「立起来」（反馈「2D 有对应的 2.5D 和 3D，用我做的一系列 node 里的节点」）。
   · 器件本体全部来自 硬件图元库的 entity-builders.js：npu / cpu / nic / ub_switch，
     DPU 沿用 nic 的语言加一颗大 ASIC（2D 图标同一个补法）；配色 = 该库深色态 _CD，helpers（Phong + 描边 + 圆角盒）照抄库页面的 _makeHelpers，
     three.js 用库自带的同一份 r134——光照、颜色与库页面一致。
   · 位置不另排：宿主把平面图里每个对象的矩形（SuperPoD / L2 平面 / SW2 / L1 SW / POD / Board / CPU / DPU / NIC / NPU）原样发过来（hw:layout），
     平面 (x, y) → 世界 (x, 0, y)，器件按库里的比例等比缩进自己的格子（同 2D <use> 的 meet）。2D 与立体一一对应。
   · 2.5D = 正交等轴测（镜头方向 [1, 1, 1]：俯角 35.26°、方位 45°，三根轴等比缩短；10.29 反馈「2.5D 用等视角的 2.5D 视图」——原来 [1, .82, 1] 俯角 30°，偏扁），只平移 / 缩放；3D = 透视，可转。
   · 4096 卡：远看每个器件是一块实例化方块（顶面 = 平面图同一档灰 / 超容红；点告警定位时 = 那条告警的状态色：琥珀 / 红），镜头进到 POD 尺度时，画面附近的 POD 换成完整图元（实例化的烘焙模板）。
   · 状态：选中 / 通信组 / 压暗 / 告警全由宿主算好按 rank 发来（hw:set），这里只负责画；点选回传 hw:pick，走宿主平面图那一套逻辑。
     每颗 NPU 一个字节（宿主 hwCodes）：bit0-1 选中态（0 常态 / 1 压暗 / 2 选中 / 3 组员）· bit2 超容 · bit3-4 占用档 ·
     bit5-6 告警定位的状态色（0 无 / 1 琥珀 / 2 红：点告警定位到的那一段 / 那张卡，远看方块填状态色、放大换整件混状态色的库状态态）。 */
(function () {
  'use strict';
  var T = window.THREE;
  var post = function (m) { try { window.parent.postMessage(m, '*'); } catch (e) { /* standalone */ } };

  // ── 图元库深色态调色板（硬件图元库.dc.html 的 _CD）与状态混色（同库 _applyStatus）────────────
  var CD = { BG: 0x313232, MAIN: 0x535151, DEEP: 0x5a5a5a, LITE: 0x78797d, DARK: 0x2e2e2e, METAL: 0x5a5a5a, GLINE: 0x2a2929, SWITCH: 0x2e3d52,
    HBM: 0x484848, AIC: 0x484848, AIV: 0x404040, SCAL: 0x525050, GOLD: 0x8B6914, BRASS: 0x8B7040, COPPER: 0x7A5C52,
    BLUE: 0x4369EF, GREEN: 0x04D793, AMBER: 0xFFAA3B, RED: 0xFF4B7B, ACNT: 0x7C8DB8, EDGE: 0x181818, STATUS: 0x3a3a3a, E9: 0x484848 };
  /* 10.29 去蓝（反馈「还是去色吧，黑白灰，内容不要蓝紫色」「黄铜色保留」「蓝色换掉」）：器件本体里带蓝相的几档换成同亮度的中性灰——
     LITE（抛光金属）、SWITCH（交换机机身）、BG（画布底，略偏青）、ACNT（库的蓝灰点缀）；黄铜 / 金 / 铜（BRASS / GOLD / COPPER）照旧；
     BLUE / GREEN / AMBER / RED 是库的状态色，只在状态态里出现（超容的红），不算器件本体。2D 图标（hw-icons.js）用同一张表 */
  var NEUTRAL = { LITE: 0x7a7a7a, SWITCH: 0x3d3d3d, BG: 0x323232, ACNT: 0x8c8c8c };
  Object.keys(NEUTRAL).forEach(function (k) { CD[k] = NEUTRAL[k]; });
  function blend(b, t, r) {
    var c = function (v) { return Math.max(0, Math.min(255, Math.round(v))); };
    return (c(((b >> 16) & 255) * (1 - r) + ((t >> 16) & 255) * r) << 16) | (c(((b >> 8) & 255) * (1 - r) + ((t >> 8) & 255) * r) << 8) | c((b & 255) * (1 - r) + (t & 255) * r);
  }
  // status：null = 默认；{ led } = 只换状态位颜色（占用档，同 2D 状态条）；{ wash } = 库的状态态（整件 22% 混色 + 下一层高亮）
  function palette(status) {
    var C = Object.assign({}, CD, { _ACTIVE: false });
    if (status && status.led != null) C.STATUS = status.led;
    if (status && status.wash != null) {
      var v = status.wash, r = 0.22;
      C.MAIN = blend(0x535151, v, r); C.DEEP = blend(0x5a5a5a, v, r); C.LITE = blend(CD.LITE, v, r * 0.65); C.AIC = blend(0x484848, v, r * 0.85);
      C.AIV = blend(0x404040, v, r); C.HBM = blend(0x484848, v, r); C.METAL = blend(0x5a5a5a, v, r * 0.8); C.DARK = blend(0x2e2e2e, v, r * 0.55);
      C.SWITCH = blend(CD.SWITCH, v, r * 0.8); C.STATUS = v; C._ACTIVE = true;
    }
    return C;
  }
  // 库页面 _makeHelpers 的深色分支（isLight=false → shininess 28、specular 0x1a1a1a、描边 EDGE 0x181818 @ .20）
  function helpers(C) {
    var phong = function (c) { return new T.MeshPhongMaterial({ color: c, shininess: 28, specular: new T.Color(0x1a1a1a), polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }); };
    var basic = function (c) { return new T.MeshBasicMaterial({ color: c, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }); };
    var em = function () { return new T.LineBasicMaterial({ color: C.EDGE || 0x181818, transparent: true, opacity: 0.20 }); };
    var bm = function (w, h, d, c) { var g = new T.BoxGeometry(w, h, d), grp = new T.Group(); grp.add(new T.Mesh(g, phong(c))); grp.add(new T.LineSegments(new T.EdgesGeometry(g), em())); return grp; };
    var rb = function (w, h, d, r, c) {
      var rx = Math.min(Math.abs(r), Math.min(Math.abs(w), Math.abs(d)) * 0.44), hw = w / 2, hd = d / 2, sh = new T.Shape();
      sh.moveTo(-hw + rx, -hd); sh.lineTo(hw - rx, -hd); sh.absarc(hw - rx, -hd + rx, rx, -Math.PI / 2, 0, false);
      sh.lineTo(hw, hd - rx); sh.absarc(hw - rx, hd - rx, rx, 0, Math.PI / 2, false);
      sh.lineTo(-hw + rx, hd); sh.absarc(-hw + rx, hd - rx, rx, Math.PI / 2, Math.PI, false);
      sh.lineTo(-hw, -hd + rx); sh.absarc(-hw + rx, -hd + rx, rx, Math.PI, Math.PI * 1.5, false); sh.closePath();
      var geo = new T.ExtrudeGeometry(sh, { depth: h, bevelEnabled: false, steps: 1, curveSegments: 6 }); geo.rotateX(-Math.PI / 2); geo.translate(0, -h / 2, 0);
      var grp = new T.Group(); grp.add(new T.Mesh(geo, phong(c)));
      var e = em(), pts = sh.getPoints(12);
      [h / 2, -h / 2].forEach(function (yv) { var p = pts.map(function (pt) { return new T.Vector3(pt.x, yv, -pt.y); }); p.push(p[0].clone()); grp.add(new T.Line(new T.BufferGeometry().setFromPoints(p), e)); });
      return grp;
    };
    return { bm: bm, rb: rb, bl: function (w, h, d, c) { return new T.Mesh(new T.BoxGeometry(w, h, d), basic(c)); }, b: function (w, h, d) { return new T.BoxGeometry(w, h, d); },
      s: phong, k: basic, cyl: function (a, b, h, s) { return new T.CylinderGeometry(a, b, h, s || 8); } };
  }

  // ── 烘焙：一组库图元 → 两块合并几何（受光 Phong / 不受光 Basic，顶点色）+ 一条描边线；底面中心归零 ─────
  function bakeGroup(g, normalize) {
    g.updateMatrixWorld(true);
    var lit = { p: [], n: [], c: [] }, unl = { p: [], n: [], c: [] }, ln = { p: [], c: [] }, v = new T.Vector3(), nm = new T.Matrix3();
    g.traverse(function (o) {
      if (o.isMesh) {
        var geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
        geo.applyMatrix4(o.matrixWorld); if (!geo.attributes.normal) geo.computeVertexNormals();
        var col = o.material.color, B = o.material.isMeshBasicMaterial ? unl : lit, P = geo.attributes.position, N = geo.attributes.normal;
        for (var i = 0; i < P.count; i++) { B.p.push(P.getX(i), P.getY(i), P.getZ(i)); B.n.push(N.getX(i), N.getY(i), N.getZ(i)); B.c.push(col.r, col.g, col.b); }
      } else if (o.isLine) {
        var P2 = o.geometry.attributes.position, seg = o.isLineSegments, a = o.material.color, k = o.material.opacity != null ? o.material.opacity : 1;
        var pt = function (i) { v.fromBufferAttribute(P2, i).applyMatrix4(o.matrixWorld); ln.p.push(v.x, v.y, v.z); ln.c.push(a.r, a.g, a.b, k); };
        if (seg) for (var j = 0; j < P2.count; j++) pt(j); else for (var j2 = 0; j2 + 1 < P2.count; j2++) { pt(j2); pt(j2 + 1); }
      }
    });
    var mk = function (B) { if (!B.p.length) return null; var gg = new T.BufferGeometry(); gg.setAttribute('position', new T.Float32BufferAttribute(B.p, 3)); gg.setAttribute('normal', new T.Float32BufferAttribute(B.n, 3)); gg.setAttribute('color', new T.Float32BufferAttribute(B.c, 3)); return gg; };
    var out = { lit: mk(lit), unl: mk(unl), line: null };
    if (ln.p.length) { out.line = new T.BufferGeometry(); out.line.setAttribute('position', new T.Float32BufferAttribute(ln.p, 3)); out.line.setAttribute('color', new T.Float32BufferAttribute(ln.c, 4)); }
    if (normalize) {
      var box = new T.Box3(); [out.lit, out.unl].forEach(function (gg) { if (gg) { gg.computeBoundingBox(); box.union(gg.boundingBox); } });
      var cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
      [out.lit, out.unl, out.line].forEach(function (gg) { if (gg) gg.translate(-cx, -box.min.y, -cz); });
      out.size = [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z];
    }
    return out;
  }
  function template(id, status, extra) {
    var C = palette(status), g = new T.Group();
    window.HWENT[id](g, C, T, helpers(C));
    if (extra) extra(g, C, helpers(C));
    return bakeGroup(g, true);
  }
  var OCC = [0x4A4A4A, 0x808080, 0xBDBDBD];   // 平面图 NPU 的占用档（c0 / c1 / c2）——远看方块顶面与放大后的状态位同一档
  var ALERT = 0xF85149;                        // 平面图的告警红（--alert）
  var WARN = 0xFAB219;                         // 平面图的告警琥珀（--warn）
  var TPL = {};
  function buildTemplates() {
    TPL.npu = OCC.map(function (c) { return template('npu', { led: c }); });
    TPL.npu.push(template('npu', { wash: CD.RED }));   // 超容 = 库的「繁忙」状态（整件混红 + die 窗口高亮）
    // 10.29 点告警定位到的那一段 / 那张卡（宿主 bit5-6）：同一个库状态态，整件混平面图同一个状态色——[4] 告警琥珀、[5] 超容红
    TPL.npu.push(template('npu', { wash: WARN }), template('npu', { wash: ALERT }));
    TPL.cpu = template('cpu', null);
    TPL.nic = template('nic', null);
    TPL.dpu = template('nic', null, function (g, C, H) {   // DPU：库里没有，nic 卡 + 中间一颗大 ASIC（银灰保留框 + 深色 die），同 2D 补法
      var s = new T.Group(); var fr = H.rb(0.86, 0.06, 0.62, 0.03, 0xA0A0A0); fr.position.y = 0.2; s.add(fr);
      var die = H.rb(0.6, 0.03, 0.42, 0.02, 0x1a1a1a); die.position.y = 0.245; s.add(die); g.add(s);
    });
    TPL.sw = template('ub_switch', null);
  }

  // ── 场景 ───────────────────────────────────────────────────────────────
  var renderer = new T.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setClearColor(0x111111, 1);
  document.body.appendChild(renderer.domElement);
  var scene = new T.Scene();
  scene.add(new T.AmbientLight(0xffffff, 0.70));                                    // 同库页面的三盏灯
  var key = new T.DirectionalLight(0xffffff, 0.65); key.position.set(5, 8, 6); scene.add(key);
  var fill = new T.DirectionalLight(0xe6e6e6, 0.18); fill.position.set(-4, 3, -2); scene.add(fill);   // 10.29：库的补光是冷蓝 0xdde8ff，会给整片灰面罩一层蓝 → 同亮度的中性白
  var world = new T.Group(); scene.add(world);

  var W0 = 1, H0 = 1, LAY = null, ST = { mode: 'iso', npu: null, focus: null, inset: { l: 0, t: 0, r: 0, b: 0 }, pod: null, board: null, rank: null };
  var ortho = new T.OrthographicCamera(-1, 1, 1, -1, -5000, 20000), persp = new T.PerspectiveCamera(36, 1, 1, 40000);
  var cam = ortho;
  var ISO_POL = Math.acos(1 / Math.sqrt(3));   // 等轴测：镜头方向 [1, 1, 1] 与竖直轴的夹角 54.74°（俯角 35.26°）
  var V = { tx: 0, tz: 0, az: Math.PI / 4, pol: ISO_POL, zoom: 1, dist: 1000 };   // 镜头：目标点 + 方位 / 俯仰 + 正交缩放 / 透视距离
  var anim = null;

  // 各层厚度（平面单位；NPU 格 7 宽）：底板 → 托盘 → 刀片 → 器件，同 2.5D 的阶梯
  var Y = { sp: 2.2, plane: 3.2, pod: 1.6, board: 1.0 };
  var lod0 = {}, lod1 = {}, pick = {}, statics = null, hl = null;
  var DEV = ['npu', 'cpu', 'dpu', 'nic', 'sw1', 'sw2'];
  function devTpl(kind, i) { return kind === 'npu' ? TPL.npu[npuTpl(i)] : kind === 'sw1' || kind === 'sw2' ? TPL.sw : TPL[kind]; }
  function npuCode(i) { return ST.npu ? ST.npu[i] || 0 : 0; }
  function npuOcc(i) { var c = npuCode(i); return (c & 4) ? 3 : (c >> 3) & 3; }   // bit2 = 超容；bit3-4 = 占用档 0..2
  function npuAl(i) { return (npuCode(i) >> 5) & 3; }                               // bit5-6 = 告警定位的状态色：0 无 / 1 琥珀 / 2 红（10.29）
  function npuTpl(i) { var a = npuAl(i); return a ? 3 + a : npuOcc(i); }            // 告警定位压过占用档：TPL.npu[4] / [5]
  function baseY(kind) { return kind === 'sw2' ? Y.sp + Y.plane : kind === 'sw1' ? Y.sp : Y.sp + Y.pod + Y.board; }
  // 器件矩阵：库图元等比缩进格子（同 2D <use> 的 xMidYMid meet），立在所在容器顶面
  function devMatrix(kind, r, tpl, m) {
    var s = Math.min(r[2] / tpl.size[0], r[3] / tpl.size[2]);
    m.makeScale(s, s, s); m.setPosition(r[0] + r[2] / 2, baseY(kind), r[1] + r[3] / 2);
    return s;
  }

  /* 容器（SuperPoD 底板 / L2 平面 / POD 托盘 / Board 刀片托盘）：同类尺寸都一样 → 各烘一个模板、实例化（一类一次绘制调用，
     与卡数无关）；描边线不常驻，只在细节档给画面附近的 POD 补上（见 updateDetail），远看不画几十万条细线 */
  var CT = {};
  function containerTemplate(kind, w, d) {
    var C = palette(null), H = helpers(C), g = new T.Group();
    if (kind === 'sp') { var a = H.rb(w, Y.sp, d, 14, CD.BG); a.position.y = Y.sp / 2; g.add(a); }               // SuperPoD 底板 = 库的画布色
    else if (kind === 'plane') { var p2 = H.rb(w, Y.plane, d, 6, CD.DARK); p2.position.y = Y.plane / 2; g.add(p2); }   // L2 平面柜体
    else if (kind === 'pod') { var p3 = H.rb(w, Y.pod, d, 7, CD.DARK); p3.position.y = Y.pod / 2; g.add(p3); }         // POD 托盘
    else {                                                                                               // Board = 库 blade 的托盘语言
      var t = H.bm(w - 0.4, Y.board, d - 0.6, CD.MAIN); t.position.y = Y.board / 2; g.add(t);           // MAIN 托盘（库里是 0.025 的小圆角，放到这一格里看不出 → 直角盒，万卡时省下几十万面）
      var fp = H.bm(w - 0.6, Y.board * 0.8, 0.35, CD.METAL); fp.position.set(0, Y.board * 0.4, d / 2 - 0.35); g.add(fp);   // METAL 前面板
      var be = H.bl(w - 1.2, 0.08, 0.08, CD.BRASS); be.position.set(0, Y.board * 0.82, d / 2 - 0.16); g.add(be);           // 黄铜包边
      var led = H.bl(w * 0.5, 0.12, 0.1, CD.STATUS); led.position.set(0, Y.board * 0.45, d / 2 - 0.12); g.add(led);       // 状态灯条
    }
    var b = bakeGroup(g, false); b.w = w; b.d = d; return b;
  }
  var CBASE = { sp: function () { return 0; }, plane: function () { return Y.sp; }, pod: function () { return Y.sp; }, board: function () { return Y.sp + Y.pod; } };
  function contMatrix(kind, r, m) { var tp = CT[kind]; m.makeScale(r[2] / tp.w, 1, r[3] / tp.d); m.setPosition(r[0] + r[2] / 2, CBASE[kind](), r[1] + r[3] / 2); return m; }
  var MAT_LIT = function () { return new T.MeshPhongMaterial({ vertexColors: true, shininess: 28, specular: new T.Color(0x1a1a1a), polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }); };
  function buildStatics() {
    if (statics) { world.remove(statics); }
    statics = new T.Group();
    var m = new T.Matrix4();
    ['sp', 'plane', 'pod', 'board'].forEach(function (k) {
      var arr = LAY[k]; if (!arr || !arr.length) return;
      CT[k] = containerTemplate(k, arr[0][2], arr[0][3]);
      [[CT[k].lit, MAT_LIT()], [CT[k].unl, new T.MeshBasicMaterial({ vertexColors: true })]].forEach(function (pr) {
        if (!pr[0]) return;
        var im = new T.InstancedMesh(pr[0], pr[1], arr.length);
        arr.forEach(function (r, i) { im.setMatrixAt(i, contMatrix(k, r, m)); });
        statics.add(im);
      });
    });
    world.add(statics);
    // 点选代理：POD / Board 两层（不画，只给射线）
    ['pod', 'board'].forEach(function (k) {
      if (pick[k]) world.remove(pick[k]);
      var arr = LAY[k], im = new T.InstancedMesh(new T.BoxGeometry(1, 1, 1), new T.MeshBasicMaterial({ visible: false }), arr.length), m = new T.Matrix4();
      var y = k === 'pod' ? Y.sp + Y.pod / 2 : Y.sp + Y.pod + Y.board / 2, h = k === 'pod' ? Y.pod : Y.board;
      arr.forEach(function (r, i) { m.makeScale(r[2], h, r[3]); m.setPosition(r[0] + r[2] / 2, y, r[1] + r[3] / 2); im.setMatrixAt(i, m); });
      im.userData.kind = k; pick[k] = im; world.add(im);
    });
  }

  // 远看：每个器件一块实例化方块（尺寸 = 库图元的包围盒按格子等比缩放），顶面颜色同平面图
  function buildLod0() {
    DEV.forEach(function (k) {
      if (lod0[k]) world.remove(lod0[k]);
      var arr = LAY[k] || [], im = new T.InstancedMesh(new T.BoxGeometry(1, 1, 1), new T.MeshPhongMaterial({ color: 0xffffff, shininess: 28, specular: new T.Color(0x1a1a1a) }), Math.max(1, arr.length));
      im.count = arr.length; im.userData.kind = k; lod0[k] = im; world.add(im);
      if (k === 'npu') pick.npu = im;
    });
    layoutLod0();
  }
  var hidden = {};   // 正被完整图元替换的器件（kind → Set）
  function layoutLod0() {
    var m = new T.Matrix4(), col = new T.Color();
    DEV.forEach(function (k) {
      var im = lod0[k], arr = LAY[k] || [], hs = hidden[k];
      arr.forEach(function (r, i) {
        var tpl = devTpl(k, i), s = Math.min(r[2] / tpl.size[0], r[3] / tpl.size[2]), w = tpl.size[0] * s, d = tpl.size[2] * s, h = tpl.size[1] * s;
        if (hs && hs.has(i)) m.makeScale(0.0001, 0.0001, 0.0001); else m.makeScale(w, h, d);
        m.setPosition(r[0] + r[2] / 2, baseY(k) + h / 2, r[1] + r[3] / 2); im.setMatrixAt(i, m);
        if (k === 'npu') { var o = npuOcc(i), al = npuAl(i); col.setHex(al ? (al === 2 ? ALERT : WARN) : o === 3 ? ALERT : OCC[o]); }
        else col.setHex(k === 'sw1' || k === 'sw2' ? CD.METAL : k === 'cpu' ? CD.LITE : CD.MAIN);
        stateTint(col, devDim(k, i, r));
        im.setColorAt(i, col);
      });
      im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    });
    invalidate();
  }
  /* 10.29 压暗 = 同平面图 --recede（.3，反馈「点击之后其他隐去的透明度再降一些，包括其他板子上的内容」）：往托盘色（MAIN）褪 70%，
     融进底下那块板里——不是 ×系数压黑（原来 ×0.3 是一块块黑洞，反而比常态更扎眼）。远看的方块直接褪颜色；近看的烘焙模板另备一份褪过的顶点色（fadeTpl）。
     哪些算「其余」：NPU 看宿主发来的压暗位（bit0-1 = 1）；CPU / DPU / NIC 看 ST.dim（宿主的 DIMCTX：-1 全部退、≥0 留下那块板），同平面图 syncDimCtx */
  var RECEDE = 0.3, FADE_TO = new T.Color(CD.MAIN);
  function devDim(k, i, r) { return k === 'npu' ? (npuCode(i) & 3) === 1 : (k === 'cpu' || k === 'dpu' || k === 'nic') && ST.dim != null && (ST.dim < 0 || r[4] !== ST.dim); }
  function stateTint(col, dim) { if (dim) col.lerp(FADE_TO, 1 - RECEDE); }
  function fadeTpl(tpl) {
    if (tpl._fade) return tpl._fade;
    var c = new T.Color(), f = function (geo) { if (!geo) return null; var g2 = geo.clone(), C9 = g2.attributes.color; for (var q = 0; q < C9.count; q++) { c.setRGB(C9.getX(q), C9.getY(q), C9.getZ(q)).lerp(FADE_TO, 1 - RECEDE); C9.setXYZ(q, c.r, c.g, c.b); } C9.needsUpdate = true; return g2; };
    tpl._fade = { lit: f(tpl.lit), unl: f(tpl.unl), line: tpl.line, size: tpl.size };
    return tpl._fade;
  }

  // 放大：画面附近的 POD 换成完整图元（每个模板一组实例）
  var detailKey = '';
  function updateDetail() {
    if (!LAY) return;
    var span = viewSpan(), want = [];
    if (span < 520) {   // 画面里装得下 ≈ 4 个 POD 宽以内才换（POD 126 宽）
      var cx = V.tx, cz = V.tz, rad = span * 0.75 + 70;
      LAY.pod.forEach(function (r, i) { var dx = r[0] + r[2] / 2 - cx, dz = r[1] + r[3] / 2 - cz; if (dx * dx + dz * dz < rad * rad) want.push(i); });
      want.sort(function (a, b) { return a - b; }); if (want.length > 12) want.length = 12;
    }
    var key = want.join(',') + '|' + (ST.npuStamp || 0) + '|' + ST.dim;
    if (key === detailKey) return; detailKey = key;
    Object.keys(lod1).forEach(function (k) { world.remove(lod1[k]); lod1[k].traverse(function (o) { if (o.isLineSegments) o.geometry.dispose(); }); });
    lod1 = {}; hidden = {};
    var podSet = {}; want.forEach(function (p) { podSet[p] = 1; });
    var groups = {};   // 模板名 → [{ kind, i }]
    DEV.forEach(function (k) {
      (LAY[k] || []).forEach(function (r, i) {
        // NPU 按 rank 归 POD；CPU / DPU / NIC 带板号；L1 SW 带组号（一组 = 两个 POD）；L2 平面的 SW2 不进细节
        var p = k === 'npu' ? Math.floor(i / 64) : k === 'sw2' ? -1 : k === 'sw1' ? (r[4] * 2 in podSet ? r[4] * 2 : r[4] * 2 + 1) : Math.floor(r[4] / 8);
        if (!(p in podSet)) return;
        var tn = (k === 'npu' ? 'npu' + npuTpl(i) : k === 'sw1' || k === 'sw2' ? 'sw' : k) + (devDim(k, i, r) ? '~' : '');   // ~ = 褪过的那一份模板
        (groups[tn] = groups[tn] || []).push({ k: k, i: i });
        (hidden[k] = hidden[k] || new Set()).add(i);
      });
    });
    var m = new T.Matrix4(), col = new T.Color();
    Object.keys(groups).forEach(function (tn) {
      var tb = tn.replace('~', ''), tpl = tb.indexOf('npu') === 0 ? TPL.npu[+tb.slice(3)] : TPL[tb], list = groups[tn], g = new T.Group();
      if (tn !== tb) tpl = fadeTpl(tpl);
      var mk = function (geo, mat) { if (!geo) return null; var im = new T.InstancedMesh(geo, mat, list.length); g.add(im); return im; };
      var a = mk(tpl.lit, new T.MeshPhongMaterial({ vertexColors: true, shininess: 28, specular: new T.Color(0x1a1a1a), polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }));
      var b = mk(tpl.unl, new T.MeshBasicMaterial({ vertexColors: true }));
      list.forEach(function (it, j) {
        devMatrix(it.k, LAY[it.k][it.i], tpl, m);
        [a, b].forEach(function (im) { if (!im) return; im.setMatrixAt(j, m); col.setRGB(1, 1, 1); im.setColorAt(j, col); });
      });
      lod1[tn] = g; world.add(g);
    });
    // 细节档的描边（库 helpers 的 EDGE @ .20）：画面附近这几个 POD 的托盘 / 刀片 / 器件各一份，合成一条线
    var L = { p: [], c: [] }, v = new T.Vector3();
    var push = function (geo, mm) { if (!geo) return; var P = geo.attributes.position, Cc = geo.attributes.color; for (var i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i).applyMatrix4(mm); L.p.push(v.x, v.y, v.z); L.c.push(Cc.getX(i), Cc.getY(i), Cc.getZ(i), Cc.getW(i)); } };
    want.forEach(function (pi) {
      var pr = LAY.pod.find(function (r) { return r[4] === pi; }); if (pr && CT.pod) push(CT.pod.line, contMatrix('pod', pr, m));
      LAY.board.forEach(function (r) { if (Math.floor(r[4] / 8) === pi && CT.board) push(CT.board.line, contMatrix('board', r, m)); });
    });
    // 器件自己的细线（鳍片、端口格…）不画：12 个 POD 加起来近 50 万条线段，面与配色已经交代清楚了
    if (L.p.length) {
      var lg = new T.BufferGeometry(); lg.setAttribute('position', new T.Float32BufferAttribute(L.p, 3)); lg.setAttribute('color', new T.Float32BufferAttribute(L.c, 4));
      lod1._lines = new T.LineSegments(lg, new T.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 1 })); world.add(lod1._lines);
    }
    layoutLod0();
    invalidate();
  }
  function viewSpan() { return cam === ortho ? (H0 / V.zoom) : V.dist * Math.tan(T.MathUtils.degToRad(persp.fov / 2)) * 2; }

  // 选中框 / 当前 POD / 当前 Board 的描边（白 = 选中，同平面图的选中白框）；10.29：选中的那张是告警定位的对象时，它的框换成那条告警的状态色（同平面图 .sel-frame.al-*）
  function updateHl() {
    if (hl) { world.remove(hl); hl.geometry.dispose(); }
    var segs = [], cols = [], cc = new T.Color(), box = function (r, y0, y1, pad, hex) {
      var x0 = r[0] - pad, x1 = r[0] + r[2] + pad, z0 = r[1] - pad, z1 = r[1] + r[3] + pad; cc.setHex(hex || 0xffffff);
      [[x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0]].forEach(function (e) { segs.push(e[0], y1, e[1], e[2], y1, e[3]); segs.push(e[0], y0, e[1], e[0], y1, e[1]); for (var q = 0; q < 4; q++) cols.push(cc.r, cc.g, cc.b); });
    };
    if (ST.rank != null && LAY.npu[ST.rank]) { var r = LAY.npu[ST.rank], t = TPL.npu[0], s = Math.min(r[2] / t.size[0], r[3] / t.size[2]), al = npuAl(ST.rank); box(r, baseY('npu'), baseY('npu') + t.size[1] * s + 0.3, 0.6, al === 2 && npuOcc(ST.rank) !== 3 ? ALERT : al === 1 ? WARN : 0); }   // 超容的那张被定位：本来就是红，框留白（红框混在超容红里认不出）
    if (ST.board != null && LAY.board[ST.board]) box(LAY.board[ST.board], Y.sp + Y.pod, Y.sp + Y.pod + Y.board + 0.2, 0.4);
    if (ST.pod != null && LAY.pod[ST.pod]) box(LAY.pod[ST.pod], Y.sp, Y.sp + Y.pod + 0.2, 1.2);
    var geo = new T.BufferGeometry(); geo.setAttribute('position', new T.Float32BufferAttribute(segs, 3)); geo.setAttribute('color', new T.Float32BufferAttribute(cols, 3));
    hl = new T.LineSegments(geo, new T.LineBasicMaterial({ vertexColors: true })); world.add(hl);
    invalidate();
  }

  // ── 镜头 ───────────────────────────────────────────────────────────────
  function applyCam() {
    var dir = new T.Vector3(Math.sin(V.pol) * Math.sin(V.az), Math.cos(V.pol), Math.sin(V.pol) * Math.cos(V.az));
    var tgt = new T.Vector3(V.tx, 0, V.tz), I = ST.inset, w = Math.max(50, W0 - I.l - I.r), h = Math.max(50, H0 - I.t - I.b);
    if (cam === ortho) {
      ortho.left = -W0 / 2 / V.zoom; ortho.right = W0 / 2 / V.zoom; ortho.top = H0 / 2 / V.zoom; ortho.bottom = -H0 / 2 / V.zoom;
      ortho.position.copy(tgt).addScaledVector(dir, 4000);
    } else { persp.aspect = W0 / H0; persp.position.copy(tgt).addScaledVector(dir, V.dist); }
    cam.up.set(0, 1, 0); cam.lookAt(tgt);
    cam.setViewOffset(W0, H0, -(I.l - I.r) / 2, -(I.t - I.b) / 2, W0, H0);   // 内容摆进卡与卡之间的安全区正中（同平面图的取景）
    cam.updateProjectionMatrix();
    void w; void h;
    if (typeof invalidate === 'function') invalidate();
  }
  // 取景：把平面矩形装进安全区（2.5D 算投影外包；3D 按外接球）
  function fitRect(r, animate) {
    if (!r) return;
    var I = ST.inset, w = Math.max(50, W0 - I.l - I.r), h = Math.max(50, H0 - I.t - I.b);
    var to = { tx: r[0] + r[2] / 2, tz: r[1] + r[3] / 2 };
    if (cam === ortho) {
      var dir = new T.Vector3(Math.sin(V.pol) * Math.sin(V.az), Math.cos(V.pol), Math.sin(V.pol) * Math.cos(V.az));
      var right = new T.Vector3(0, 1, 0).cross(dir).normalize(), up = dir.clone().cross(right).normalize();
      var xs = [], ys = [];
      [[r[0], r[1]], [r[0] + r[2], r[1]], [r[0], r[1] + r[3]], [r[0] + r[2], r[1] + r[3]]].forEach(function (p) { [0, 12].forEach(function (yy) { var q = new T.Vector3(p[0] - to.tx, yy, p[1] - to.tz); xs.push(q.dot(right)); ys.push(q.dot(up)); }); });
      var ex = Math.max.apply(null, xs) - Math.min.apply(null, xs), ey = Math.max.apply(null, ys) - Math.min.apply(null, ys);
      to.zoom = Math.min(w / ex, h / ey) * 0.9;
    } else {
      var rad = Math.sqrt(r[2] * r[2] + r[3] * r[3]) / 2, fov = T.MathUtils.degToRad(persp.fov) / 2, k = Math.min(w / W0, h / H0);
      to.dist = rad / Math.sin(fov) / k * 0.95;
    }
    if (!animate) { Object.assign(V, to); applyCam(); updateDetail(); return; }
    var from = { tx: V.tx, tz: V.tz, zoom: V.zoom, dist: V.dist }, t0 = performance.now(), D = 520;
    anim = function (now) {
      var u = Math.min(1, (now - t0) / D), e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      V.tx = from.tx + (to.tx - from.tx) * e; V.tz = from.tz + (to.tz - from.tz) * e;
      if (to.zoom) V.zoom = Math.exp(Math.log(from.zoom) + (Math.log(to.zoom) - Math.log(from.zoom)) * e);
      if (to.dist) V.dist = from.dist + (to.dist - from.dist) * e;
      applyCam(); if (u >= 1) { anim = null; updateDetail(); }
    };
  }
  function setMode(m) {
    if (m === ST.mode && cam === (m === '3d' ? persp : ortho)) return;
    ST.mode = m; cam = m === '3d' ? persp : ortho;
    if (m !== '3d') { V.az = Math.PI / 4; V.pol = ISO_POL; }
    // 两种镜头的「看多大」互换：正交 zoom ↔ 透视距离
    if (m === '3d') V.dist = (H0 / V.zoom) / (2 * Math.tan(T.MathUtils.degToRad(persp.fov / 2)));
    else V.zoom = H0 / (V.dist * 2 * Math.tan(T.MathUtils.degToRad(persp.fov / 2)));
    applyCam(); detailKey = ''; updateDetail();
  }

  // ── 交互：2.5D 左键平移；3D 左键转、右键 / Shift 平移；滚轮缩放（以指针为中心）────────────
  var drag = null, ray = new T.Raycaster(), ndc = new T.Vector2(), tip = document.getElementById('tip');
  var el = renderer.domElement;
  el.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  el.addEventListener('pointerdown', function (e) { drag = { x: e.clientX, y: e.clientY, b: e.button, sh: e.shiftKey, moved: false }; el.setPointerCapture(e.pointerId); });
  el.addEventListener('pointermove', function (e) {
    if (!drag) { hover(e); return; }
    var dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    drag.x = e.clientX; drag.y = e.clientY; anim = null;
    if (ST.mode === '3d' && drag.b === 0 && !drag.sh) { V.az -= dx * 0.006; V.pol = Math.max(0.12, Math.min(1.45, V.pol - dy * 0.006)); }
    else { var u = cam === ortho ? 1 / V.zoom : viewSpan() / H0, ca = Math.cos(V.az), sa = Math.sin(V.az), sc = 1 / Math.max(0.3, Math.cos(V.pol));
      V.tx -= (dx * ca + dy * sa * sc) * u; V.tz -= (-dx * sa + dy * ca * sc) * u; }
    applyCam(); schedDetail();
  });
  el.addEventListener('pointerup', function (e) { var d = drag; drag = null; if (d && !d.moved && d.b === 0) click(e); });
  el.addEventListener('wheel', function (e) {
    e.preventDefault(); anim = null;
    var f = Math.exp(-e.deltaY * 0.0015), before = groundAt(e.clientX, e.clientY);
    if (cam === ortho) V.zoom = Math.max(0.02, Math.min(60, V.zoom * f)); else V.dist = Math.max(20, Math.min(30000, V.dist / f));
    applyCam(); var after = groundAt(e.clientX, e.clientY);
    if (before && after) { V.tx += before.x - after.x; V.tz += before.z - after.z; applyCam(); }
    schedDetail();
  }, { passive: false });
  var detT = 0; function schedDetail() { clearTimeout(detT); detT = setTimeout(updateDetail, 140); }
  function setNdc(x, y) { var R = el.getBoundingClientRect(); ndc.set(((x - R.left) / R.width) * 2 - 1, -((y - R.top) / R.height) * 2 + 1); ray.setFromCamera(ndc, cam); }
  function groundAt(x, y, h) { setNdc(x, y); var p = new T.Vector3(); return ray.ray.intersectPlane(new T.Plane(new T.Vector3(0, 1, 0), -(h == null ? Y.sp : h)), p) ? p : null; }
  function hit(x, y) {
    if (!LAY) return null; setNdc(x, y);
    var hs = ray.intersectObjects([pick.npu, pick.board, pick.pod].filter(Boolean), false);
    // 射线先打到的是哪颗 NPU 方块就是哪颗（远看方块都在，这个最准）
    if (hs.length && hs[0].object === pick.npu) return { kind: 'rank', rank: hs[0].instanceId };
    /* 隐藏（被完整图元替换）的 NPU 方块缩成点，用格子本身补一次：在 NPU 封装半高那一层反查格子。
       原来按 SuperPoD 底板顶面（比刀片顶面低 2.6）反查，斜着看落点往远处偏出大半格：3D 里点 1355 选成远处那一行的 1347，
       放大后点卡落进卡缝、被当成点板直接进了板，选不中、也就下钻不了（反馈「点不到下钻的场景了还有我3d的场景了」） */
    var r0 = LAY.npu[0], t0 = TPL.npu && TPL.npu[0], hN = r0 && t0 ? t0.size[1] * Math.min(r0[2] / t0.size[0], r0[3] / t0.size[2]) : 1.2;
    var g = groundAt(x, y, baseY('npu') + hN / 2);
    if (g) { var n = npuAt(g.x, g.z); if (n != null) return { kind: 'rank', rank: n }; }
    for (var i = 0; i < hs.length; i++) { var o = hs[i].object; if (o === pick.npu) return { kind: 'rank', rank: hs[i].instanceId }; if (o === pick.board) return { kind: 'board', board: LAY.board[hs[i].instanceId][4] }; if (o === pick.pod) return { kind: 'pod', pod: LAY.pod[hs[i].instanceId][4] }; }
    return null;
  }
  function npuAt(x, z) {   // NPU 顶面略高于托盘：取托盘顶面的地面交点附近的格子
    var a = LAY.npu, best = null;
    for (var p = 0; p < LAY.pod.length; p++) { var r = LAY.pod[p]; if (x < r[0] - 4 || x > r[0] + r[2] + 4 || z < r[1] - 4 || z > r[1] + r[3] + 4) continue;
      for (var i = r[4] * 64; i < Math.min(a.length, r[4] * 64 + 64); i++) { var q = a[i]; if (q && x >= q[0] - 0.8 && x <= q[0] + q[2] + 0.8 && z >= q[1] - 0.8 && z <= q[1] + q[3] + 0.8) best = i; } }
    return best;
  }
  function click(e) { var h = hit(e.clientX, e.clientY); tip.style.display = 'none'; post(h ? Object.assign({ type: 'hw:pick' }, h) : { type: 'hw:pick', kind: 'none' }); }   // 点完收起悬停提示：选中 / 取景变了，「再点去哪」要等下一次悬停按新状态写
  var hovT = 0;
  function hover(e) {
    var now = performance.now(); if (now - hovT < 60) return; hovT = now;
    var h = hit(e.clientX, e.clientY), txt = '';
    if (h && h.kind === 'rank') txt = 'rank ' + h.rank + ' · Board ' + Math.floor(h.rank / 8) + ' · Rack ' + Math.floor(h.rank / 64) + ' · SuperPoD ' + Math.floor(h.rank / 1024)
      + (h.rank !== ST.rank ? '' : ST.pod === Math.floor(h.rank / 64) || ST.board === Math.floor(h.rank / 8) ? ' · 再点进 NPU 页' : ' · 再点放大到 Rack');   // 10.29 选中的那颗再点去哪（同宿主 hwPick）
    else if (h && h.kind === 'board') txt = 'Board ' + h.board + ' · rank ' + h.board * 8 + '–' + (h.board * 8 + 7);
    else if (h && h.kind === 'pod') txt = 'Rack ' + h.pod + ' · 机柜 · 8 Board · 64 NPU';
    el.style.cursor = !h ? 'default' : h.kind === 'rank' && h.rank === ST.rank ? 'zoom-in' : 'pointer';   // 选中的那颗再点 = 放大到 POD / 进 NPU 页（同平面图）
    if (!txt) { tip.style.display = 'none'; return; }
    tip.textContent = txt; tip.style.display = 'block'; tip.style.left = e.clientX + 'px'; tip.style.top = e.clientY + 'px';
  }
  el.addEventListener('pointerleave', function () { tip.style.display = 'none'; });

  function resize() {
    W0 = window.innerWidth; H0 = window.innerHeight; renderer.setSize(W0, H0); applyCam();
  }
  window.addEventListener('resize', resize);
  // 按需渲染：镜头 / 状态没变就不画（静止时不占 GPU）；动画进行中每帧画
  var dirty = true;
  function invalidate() { dirty = true; }
  (function loop(now) { requestAnimationFrame(loop); if (anim) { anim(now || performance.now()); dirty = true; } if (!dirty) return; dirty = false; renderer.render(scene, cam); })();

  // ── 宿主协议 ─────────────────────────────────────────────────────────────
  window.addEventListener('message', function (ev) {
    var d = ev.data || {};
    if (d.type === 'hw:layout') {
      LAY = d.layout; if (!TPL.npu) buildTemplates();
      buildStatics(); buildLod0(); detailKey = ''; updateHl();
      if (!ST.focus) fitRect([0, 0, LAY.W, LAY.H], false);
    } else if (d.type === 'hw:set') {
      var s = d.state || {}, npuChanged = s.npu && s.npu !== ST.npu;
      if (s.inset) ST.inset = s.inset;
      if (s.mode && s.mode !== ST.mode) setMode(s.mode);
      if (s.npu) { ST.npu = s.npu; ST.npuStamp = (ST.npuStamp || 0) + 1; }
      ST.rank = s.rank; ST.board = s.board; ST.pod = s.pod; if (ST.dim !== s.dim) { ST.dim = s.dim; npuChanged = true; }
      if (!LAY) return;
      if (npuChanged) { detailKey = ''; updateDetail(); }
      updateHl();
      var fk = JSON.stringify(s.focus || null);
      if (fk !== ST.fk) { ST.fk = fk; fitRect(s.focus || [0, 0, LAY.W, LAY.H], !s.instant); }
      else applyCam();
    } else if (d.type === 'hw:zoom') {
      if (d.dir === 'reset') { ST.fk = ''; fitRect([0, 0, LAY.W, LAY.H], true); return; }
      var f = d.dir === 'in' ? 1.4 : 1 / 1.4; anim = null;
      if (cam === ortho) V.zoom *= f; else V.dist /= f; applyCam(); schedDetail();
    }
  });
  // ?fps=1：左下角实时帧率（在自己的机器上核对流畅度用；按需渲染时静止不计帧）
  if (/[?&]fps=1/.test(location.search)) {
    var fpsEl = document.createElement('div'); fpsEl.style.cssText = 'position:fixed;left:12px;bottom:12px;padding:4px 8px;border-radius:6px;background:rgba(0,0,0,.6);color:#9f9;font:11px ui-monospace,monospace;pointer-events:none';
    document.body.appendChild(fpsEl);
    var fN = 0, fT = performance.now(), r0 = renderer.render.bind(renderer);
    renderer.render = function (sc, c) { r0(sc, c); fN++; var now = performance.now(); if (now - fT > 500) { var i = renderer.info.render; fpsEl.textContent = Math.round(fN * 1000 / (now - fT)) + ' fps · ' + i.calls + ' draws · ' + Math.round(i.triangles / 1000) + 'k tris · ' + (LAY ? LAY.npu.length : 0) + ' NPU'; fN = 0; fT = now; } };
  }
  // 只读的测试钩子：某颗 NPU / 某块 Board 中心在屏幕上的位置（回归脚本按它点，不靠猜坐标）
  window.__hw = { project: function (kind, i) {
    var r = kind === 'board' ? LAY && LAY.board[i] : LAY && LAY.npu[i]; if (!r) return null;
    var v = new T.Vector3(r[0] + r[2] / 2, kind === 'board' ? Y.sp + Y.pod + Y.board : baseY('npu') + 1, r[1] + r[3] / 2).project(cam);
    return { x: (v.x + 1) / 2 * W0, y: (1 - v.y) / 2 * H0 };
  }, view: function () { return { tx: V.tx, tz: V.tz, zoom: V.zoom, dist: V.dist, mode: ST.mode, detail: detailKey }; },
    // 性能测量：连续 n 帧边转边画，返回帧耗时（ms）与每帧绘制调用 / 三角面
    bench: function (n, spin) {
      return new Promise(function (res) {
        var ts = [], k = 0, last = performance.now(), info = renderer.info.render;
        (function step() {
          if (spin === 'rot') V.az += 0.02; else if (spin === 'zoom') { if (cam === ortho) V.zoom *= (k % 60 < 30 ? 1.03 : 1 / 1.03); else V.dist *= (k % 60 < 30 ? 0.97 : 1 / 0.97); }
          else { V.tx += Math.sin(k / 10) * 4; }
          applyCam(); renderer.render(scene, cam); var gl = renderer.getContext(); gl.finish();
          var now = performance.now(); ts.push(now - last); last = now;
          if (++k < n) requestAnimationFrame(step);
          else { ts.sort(function (a, b) { return a - b; }); var avg = ts.reduce(function (a, b) { return a + b; }, 0) / ts.length;
            res({ avg: +avg.toFixed(1), p95: +ts[Math.floor(ts.length * 0.95)].toFixed(1), calls: info.calls, tris: info.triangles, lines: info.lines }); }
        })();
      });
    } };
  resize();
  post({ type: 'hw:ready' });
})();
