import React, { Suspense, useEffect, useMemo, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Environment, useGLTF } from "@react-three/drei";
import * as THREE from "three";

function findByIncludes(root: THREE.Object3D, key: string) {
  const k = key.toLowerCase();
  let found: THREE.Object3D | null = null;
  root.traverse((o) => {
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

    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = cam.fov * (Math.PI / 180);
    let distance = maxDim / (2 * Math.tan(fov / 2));
    distance *= 1.28;

    // Aim slightly above center (chest/head)
    const aim = center.clone();
    aim.y = center.y + size.y * 0.10;

    cam.position.set(center.x, center.y + size.y * 0.15, center.z + distance);
    cam.lookAt(aim);
    cam.updateProjectionMatrix();
  }, [camera, target, version]);

  return null;
}

function Model({ speaking }: { speaking: boolean }) {
  const gltf = useGLTF("/avatar/tutor.glb");
  const [frameVersion, setFrameVersion] = useState(0);

  const bones = useMemo(() => {
    const root = gltf.scene;

    const head = findByIncludes(root, "mixamorighead_06");
    const leftShoulder = findByIncludes(root, "mixamorigleftshoulder_08");
    const rightShoulder = findByIncludes(root, "mixamorigrightshoulder_032");
    const leftArm = findByIncludes(root, "mixamorigleftarm_09");
    const rightArm = findByIncludes(root, "mixamorigrightarm_033");

    const jaw =
      findByIncludes(root, "mixamorigjaw") || findByIncludes(root, "jaw");

    return { head, leftShoulder, rightShoulder, leftArm, rightArm, jaw };
  }, [gltf.scene]);

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

    const applyFromRest = (
      b: THREE.Object3D | null,
      dx: number,
      dy: number,
      dz: number
    ) => {
      if (!b) return;
      const r = (b as any).__restRot;
      if (!r) return;
      b.rotation.set(r.x + dx, r.y + dy, r.z + dz);
    };

    if (head) head.rotation.x = -0.12;

    applyFromRest(leftShoulder, 0.08, 0.10, -0.30);
    applyFromRest(rightShoulder, 0.08, -0.10, 0.30);

    applyFromRest(leftArm, 0.55, 0.00, -0.05);
    applyFromRest(rightArm, 0.55, 0.00, 0.05);

    gltf.scene.updateMatrixWorld(true);

    // Force AutoFrame to re-run after pose changes
    setFrameVersion((v) => v + 1);
  }, [bones, gltf.scene]);

  useEffect(() => {
    const { jaw } = bones;
    if (!jaw) return;

    let t = 0;
    const id = window.setInterval(() => {
      const open = speaking ? 0.12 + 0.10 * Math.sin(t) : 0;
      jaw.rotation.x = open;
      t += 0.35;
    }, 60);

    return () => window.clearInterval(id);
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
  height = 650,
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