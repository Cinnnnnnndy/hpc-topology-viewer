// ─────────────────────────────────────────────────────────────────────────────
// PartModel — render an installed open-source GLB in place of procedural geometry.
//
// Usage (drop-in, zero behaviour change until a .glb exists):
//
//   <ModelOr partId="npu-accelerator-module" size={[w, h, d]}>
//     {... existing procedural meshes (the fallback) ...}
//   </ModelOr>
//
// If models/<partId>.glb is present it is loaded, oriented (parts-catalog
// modelRotationDeg), auto-centered, and uniformly scaled to FIT the on-screen
// slot `size` (same scene units as the procedural geometry it replaces). If no
// model is installed — or it fails to load — the children render unchanged.
// ─────────────────────────────────────────────────────────────────────────────
import { Suspense, useMemo, type ReactNode } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { hasPartModel, resolvePartModelUrl } from './model-registry';
import { partRotationDeg } from './parts-catalog';

/** 'contain' = uniform scale to fit inside the slot (no distortion, default).
 *  'stretch' = per-axis scale to exactly fill the slot (may distort). */
export type FitMode = 'contain' | 'stretch';

function GlbModel({ url, partId, size, fit }: { url: string; partId: string; size: [number, number, number]; fit: FitMode }) {
  const { scene } = useGLTF(url);
  const object = useMemo(() => {
    // Clone so the same cached GLTF can be placed in many slots independently.
    const root = scene.clone(true);
    // 1) orient (applied before measuring so the fit uses the final pose)
    const [rx, ry, rz] = partRotationDeg(partId);
    root.rotation.set(
      THREE.MathUtils.degToRad(rx),
      THREE.MathUtils.degToRad(ry),
      THREE.MathUtils.degToRad(rz),
    );
    root.updateWorldMatrix(true, true);
    // 2) measure → center → fit-scale to the slot
    const box = new THREE.Box3().setFromObject(root);
    const dim = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(dim);
    box.getCenter(center);
    const [w, h, d] = size;
    const sx = dim.x > 1e-6 ? w / dim.x : 1;
    const sy = dim.y > 1e-6 ? h / dim.y : 1;
    const sz = dim.z > 1e-6 ? d / dim.z : 1;
    const wrap = new THREE.Group();
    if (fit === 'stretch') {
      wrap.scale.set(sx, sy, sz);
    } else {
      const s = Math.min(sx, sy, sz);
      wrap.scale.setScalar(s);
    }
    // center the model at the group origin (matches centered procedural slabs)
    root.position.sub(center);
    wrap.add(root);
    return wrap;
  }, [scene, partId, size, fit]);

  return <primitive object={object} />;
}

/** Render an installed GLB for `partId`, else fall back to `children`. */
export function ModelOr({ partId, size, fit = 'contain', children }: {
  partId: string; size: [number, number, number]; fit?: FitMode; children: ReactNode;
}) {
  if (!hasPartModel(partId)) return <>{children}</>;
  const url = resolvePartModelUrl(partId)!;
  // Suspense fallback = the procedural children, so there is never a blank frame.
  return (
    <Suspense fallback={<>{children}</>}>
      <GlbModel url={url} partId={partId} size={size} fit={fit} />
    </Suspense>
  );
}
