(function attachPtoMoeRoutingData(globalScope, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalScope.PtoMoeRoutingData = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createRoutingDataApi() {
  'use strict';

  const MODEL = Object.freeze({
    totalLayers: 46,
    denseLayers: Object.freeze([0, 1]),
    moeLayers: Object.freeze(Array.from({ length: 44 }, (_, index) => index + 2)),
    expertCount: 256,
    rankCount: 128,
    expertsPerRank: 2,
    topK: 8,
    batchSize: 128,
  });

  function mulberry32(seed) {
    let value = seed >>> 0;
    return function random() {
      value += 0x6D2B79F5;
      let output = value;
      output = Math.imul(output ^ (output >>> 15), output | 1);
      output ^= output + Math.imul(output ^ (output >>> 7), output | 61);
      return ((output ^ (output >>> 14)) >>> 0) / 4294967296;
    };
  }

  function expertToRank(expertId) {
    const shard = Math.floor(Number(expertId) / MODEL.expertsPerRank);
    if (shard === 32) return 42;
    if (shard === 42) return 32;
    return shard;
  }

  function expertsForRank(rankId) {
    const rank = Number(rankId);
    const shard = rank === 42 ? 32 : rank === 32 ? 42 : rank;
    return [shard * MODEL.expertsPerRank, shard * MODEL.expertsPerRank + 1];
  }

  function createTokenRoute(tokenId, layer) {
    const random = mulberry32((tokenId + 1) * 0x45D9F3B ^ (layer + 11) * 0x119DE1F3);
    const selected = new Set();
    if (layer === 27) {
      if (tokenId < 7 || tokenId === 37) selected.add(64);
      if ((tokenId >= 7 && tokenId < 14) || tokenId === 37) selected.add(65);
    }
    const hotExperts = [
      (layer * 17 + 3) % MODEL.expertCount,
      (layer * 29 + 47) % MODEL.expertCount,
      (layer * 43 + 91) % MODEL.expertCount,
      (layer * 11 + 173) % MODEL.expertCount,
    ];
    for (let slot = selected.size; slot < MODEL.topK; slot += 1) {
      let expertId;
      if (slot < 2 && random() < 0.72) expertId = hotExperts[(tokenId + slot + layer) % hotExperts.length];
      else expertId = Math.floor(random() * MODEL.expertCount);
      while (selected.has(expertId) || (layer === 27 && (expertId === 64 || expertId === 65))) expertId = (expertId + 1) % MODEL.expertCount;
      selected.add(expertId);
    }
    const scores = Array.from(selected, (expertId, index) => ({ expertId, score: 1.1 - index * 0.055 + random() * 0.42 }))
      .sort((left, right) => right.score - left.score);
    const total = scores.reduce((sum, item) => sum + item.score, 0);
    return scores.map((item) => Object.freeze({
      expertId: item.expertId,
      rankId: expertToRank(item.expertId),
      weight: item.score / total,
    }));
  }

  function createRoutingTrace() {
    const trace = new Map();
    MODEL.moeLayers.forEach((layer) => {
      trace.set(layer, Object.freeze(Array.from({ length: MODEL.batchSize }, (_, tokenId) => Object.freeze(createTokenRoute(tokenId, layer)))));
    });
    return trace;
  }

  function computeLayerStats(routes) {
    const expertLoads = new Uint16Array(MODEL.expertCount);
    const rankLoads = new Uint16Array(MODEL.rankCount);
    routes.forEach((route) => route.forEach(({ expertId, rankId }) => {
      expertLoads[expertId] += 1;
      rankLoads[rankId] += 1;
    }));
    const totalCopies = routes.length * MODEL.topK;
    const averageExpertLoad = totalCopies / MODEL.expertCount;
    const averageRankLoad = totalCopies / MODEL.rankCount;
    const variance = Array.from(expertLoads).reduce((sum, load) => sum + Math.pow(load - averageExpertLoad, 2), 0) / expertLoads.length;
    return Object.freeze({
      expertLoads,
      rankLoads,
      totalCopies,
      averageExpertLoad,
      averageRankLoad,
      coefficientOfVariation: Math.sqrt(variance) / averageExpertLoad,
      overloadThreshold: averageExpertLoad * 1.5,
      rankOverloadThreshold: averageRankLoad * 1.5,
      overloadedExperts: Array.from(expertLoads).filter((load) => load > averageExpertLoad * 1.5).length,
      idleExperts: Array.from(expertLoads).filter((load) => load === 0).length,
      maximumExpertLoad: Math.max(...expertLoads),
      maximumRankLoad: Math.max(...rankLoads),
    });
  }

  function validateTrace(trace) {
    const errors = [];
    if (!(trace instanceof Map)) errors.push('Trace must be a Map keyed by MoE layer.');
    MODEL.moeLayers.forEach((layer) => {
      const routes = trace.get(layer);
      if (!Array.isArray(routes) || routes.length !== MODEL.batchSize) {
        errors.push(`L${layer} must contain ${MODEL.batchSize} token routes.`);
        return;
      }
      routes.forEach((route, tokenId) => {
        if (!Array.isArray(route) || route.length !== MODEL.topK) {
          errors.push(`L${layer}/T${tokenId} must contain exactly ${MODEL.topK} experts.`);
          return;
        }
        const experts = new Set();
        let weightSum = 0;
        route.forEach(({ expertId, rankId, weight }) => {
          if (!Number.isInteger(expertId) || expertId < 0 || expertId >= MODEL.expertCount) errors.push(`L${layer}/T${tokenId} has invalid expert ${expertId}.`);
          if (rankId !== expertToRank(expertId)) errors.push(`L${layer}/T${tokenId}/E${expertId} has invalid rank ${rankId}.`);
          experts.add(expertId);
          weightSum += weight;
        });
        if (experts.size !== MODEL.topK) errors.push(`L${layer}/T${tokenId} contains duplicate experts.`);
        if (Math.abs(weightSum - 1) > 1e-9) errors.push(`L${layer}/T${tokenId} router weights do not sum to 1.`);
      });
    });
    return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
  }

  return Object.freeze({ MODEL, expertToRank, expertsForRank, createRoutingTrace, computeLayerStats, validateTrace });
});
