import React, { Suspense, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { Environment, OrbitControls, useGLTF } from "@react-three/drei";
import * as THREE from "three";

function Model({ speaking }: { speaking: boolean }) {
  // Loads from /public/avatar/tutor.glb
  const gltf = useGLTF("/avatar/tutor.glb");

  // Try to find a jaw bone by common names
  const jaw = useMemo(() => {
    const root = gltf.scene;
    let found: THREE.Object3D | null = null;
    root.traverse((o) => {
      const n = (o.name || "").toLowerCase();
      if (n === "jaw" || n.includes("jaw") || n.includes("mixamorigjaw")) {
        found = o;
      }
    });
    return found;
  }, [gltf.scene]);

  // Simple “talking” effect:
  // If speaking, gently open/close jaw. If no jaw bone exists, do nothing.
  React.useFrame?.(() => {}); // (keeps TS happy if you later add useFrame)

  // We’ll animate using a tiny interval to avoid complexity for now
  React.useEffect(() => {
    if (!jaw) return;

    let t = 0;
    const id = window.setInterval(() => {
      // speaking -> oscillate; not speaking -> close mouth
      const open = speaking ? 0.22 + 0.12 * Math.sin(t) : 0;
      jaw.rotation.x = open; // rotate down/up
      t += 0.35;
    }, 60);

    return () => window.clearInterval(id);
  }, [jaw, speaking]);

  return <primitive object={gltf.scene} />;
}

export default function TutorAvatar3D({
  speaking,
  height = 180,
}: {
  speaking: boolean;
  height?: number;
}) {
  return (
    <div style={{ width: "100%", height }}>
      <Canvas
        camera={{ position: [0, 1.4, 2.2], fov: 35 }}
        gl={{ antialias: true, alpha: true }}
      >
        <ambientLight intensity={0.6} />
        <directionalLight position={[3, 5, 2]} intensity={1.0} />

        <Suspense fallback={null}>
          <group position={[0, -1.1, 0]}>
            <Model speaking={speaking} />
          </group>
          <Environment preset="city" />
        </Suspense>

        {/* locked camera: just for debugging you can enable rotate */}
        <OrbitControls enablePan={false} enableZoom={false} />
      </Canvas>
    </div>
  );
}

// Preload
useGLTF.preload("/avatar/tutor.glb");
