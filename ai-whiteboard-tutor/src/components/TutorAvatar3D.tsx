import React, { Suspense, useEffect, useMemo, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Environment, useGLTF } from "@react-three/drei";
import * as THREE from "three";

function findByIncludes(root: THREE.Object3D, key: string) {
  const k = key.toLowerCase();
  let found: THREE.Object3D | null = null;
  root.traverse((o: THREE.Object3D) => {
    if ((o.name || "").toLowerCase().includes(k)) found = o;
  });
  return found;
}

function AutoFrame({
  target,
  version,
}: {
  target: THREE.Object3D;
  version: number;
}) {
  const { camera } = useThree();

  useEffect(() => {
    const box = new THREE.Box3().setFromObject(target);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    const cam = camera as THREE.PerspectiveCamera;
    cam.fov = 38;
    cam.updateProjectionMatrix();

    const fov = cam.fov * (Math.PI / 180);

    // Fit to HEIGHT
    let distance = size.y / (2 * Math.tan(fov / 2));
    distance *= 1.28; // your "perfect" padding

    const aim = center.clone();
    aim.y = center.y + size.y * 0.10;

    cam.position.set(center.x, center.y - size.y * 0.15, center.z + distance);
    cam.lookAt(aim);
    cam.updateProjectionMatrix();
  }, [camera, target, version]);

  return null;
}

type Bones = {
  head: THREE.Object3D | null;
  leftShoulder: THREE.Object3D | null;
  rightShoulder: THREE.Object3D | null;
  leftArm: THREE.Object3D | null;
  rightArm: THREE.Object3D | null;
  jaw: THREE.Object3D | null;
  mouthTargets: THREE.Object3D[]; // ✅ all mouth-related meshes/objects
};

function Model({ speaking }: { speaking: boolean }) {
  const gltf = useGLTF("/avatar/tutor.glb");
  const [frameVersion, setFrameVersion] = useState(0);

  const bones = useMemo<Bones>(() => {
    const root = gltf.scene;

    const head: THREE.Object3D | null = findByIncludes(root, "mixamorighead_06");
    const leftShoulder: THREE.Object3D | null = findByIncludes(root, "mixamorigleftshoulder_08");
    const rightShoulder: THREE.Object3D | null = findByIncludes(root, "mixamorigrightshoulder_032");
    const leftArm: THREE.Object3D | null = findByIncludes(root, "mixamorigleftarm_09");
    const rightArm: THREE.Object3D | null = findByIncludes(root, "mixamorigrightarm_033");

    const jaw: THREE.Object3D | null =
      findByIncludes(root, "mixamorigjaw") || findByIncludes(root, "jaw");

    // ✅ Collect any object that looks mouth-related
    const mouthTargets: THREE.Object3D[] = [];
    root.traverse((o: THREE.Object3D) => {
      const n = (o.name || "").toLowerCase();
      if (
        n.includes("mouth") ||
        n.includes("teeth") ||
        n.includes("lip") ||
        n.includes("tongue")
      ) {
        mouthTargets.push(o);
      }
    });

    // Debug (safe): see in console on Netlify if we found anything
    console.log("Mouth targets found:", mouthTargets.map((m) => m.name));

    return { head, leftShoulder, rightShoulder, leftArm, rightArm, jaw, mouthTargets };
  }, [gltf.scene]);

  // Pose fix (stable): store rest pose and apply offsets
  useEffect(() => {
    const { head, leftShoulder, rightShoulder, leftArm, rightArm } = bones;

    const storeRest = (b: THREE.Object3D | null) => {
      if (!b) return;
      const anyB = b as any;
      if (!anyB.__restRot) {
        anyB.__restRot = { x: b.rotation.x, y: b.rotation.y, z: b.rotation.z };
      }
    };

    storeRest(leftShoulder);
    storeRest(rightShoulder);
    storeRest(leftArm);
    storeRest(rightArm);

    const applyFromRest = (b: THREE.Object3D | null, dx: number, dy: number, dz: number) => {
      if (!b) return;
      const r = (b as any).__restRot as { x: number; y: number; z: number } | undefined;
      if (!r) return;
      b.rotation.set(r.x + dx, r.y + dy, r.z + dz);
    };

    if (head) head.rotation.x = -0.12;

    applyFromRest(leftShoulder, 0.05, 0.35, 0);
    applyFromRest(rightShoulder, 0.05, -0.35, 0);

    applyFromRest(leftArm, 0.55, 0.25, -0.12);
    applyFromRest(rightArm, 0.55, -0.25, 0.12);

    gltf.scene.updateMatrixWorld(true);
    setFrameVersion((v) => v + 1);
  }, [bones, gltf.scene]);

  // ✅ Talking: jaw if available, otherwise animate ALL mouth targets
  useEffect(() => {
    const { jaw, mouthTargets } = bones;
    if (!jaw && mouthTargets.length === 0) return;

    // Store base transforms once
    for (const m of mouthTargets) {
      const anyM = m as any;
      if (!anyM.__base) {
        anyM.__base = {
          sx: m.scale.x,
          sy: m.scale.y,
          sz: m.scale.z,
          px: m.position.x,
          py: m.position.y,
          pz: m.position.z,
        };
      }
    }

    let t = 0;
    const id = window.setInterval(() => {
      const open = speaking ? 0.12 + 0.10 * Math.sin(t) : 0;

      if (jaw) {
        jaw.rotation.x = open;
      }

      // Stronger animation so it's visible
      for (const m of mouthTargets) {
        const base = (m as any).__base as {
          sx: number; sy: number; sz: number;
          px: number; py: number; pz: number;
        };

        // Scale "open" and nudge slightly so it is noticeable
        m.scale.set(base.sx, base.sy * (1 + open * 5.5), base.sz * (1 + open * 1.2));
        m.position.set(base.px, base.py - open * 0.015, base.pz);
      }

      t += 0.35;
    }, 60);

    return () => {
      window.clearInterval(id);
      // Restore
      for (const m of mouthTargets) {
        const base = (m as any).__base;
        if (base) {
          m.scale.set(base.sx, base.sy, base.sz);
          m.position.set(base.px, base.py, base.pz);
        }
      }
    };
  }, [bones, speaking]);

  return (
    <>
      <primitive object={gltf.scene} />
      <AutoFrame target={gltf.scene} version={frameVersion} />
    </>
  );
}

export default function TutorAvatar3D({
  speaking,
  height = 800,
}: {
  speaking: boolean;
  height?: number;
}) {
  return (
    <div style={{ width: "100%", height }}>
      <Canvas
        camera={{ position: [0, 1.5, 3], fov: 38 }}
        gl={{ antialias: true, alpha: true }}
      >
        <ambientLight intensity={0.6} />
        <directionalLight position={[3, 5, 2]} intensity={1.0} />

        <Suspense fallback={null}>
          <Model speaking={speaking} />
          <Environment preset="city" />
        </Suspense>
      </Canvas>
    </div>
  );
}

useGLTF.preload("/avatar/tutor.glb");
