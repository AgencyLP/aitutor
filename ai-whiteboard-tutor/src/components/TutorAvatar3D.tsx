import React, {
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, useAnimations, useGLTF } from "@react-three/drei";
import { SkeletonUtils } from "three-stdlib";
import * as THREE from "three";

type TutorAvatar3DProps = {
  height?: number;
  speaking?: boolean;
};

function AvatarModel({ speaking = false }: { speaking?: boolean }) {
  const groupRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Object3D | null>(null);
  const { camera } = useThree();

  const { scene, animations } = useGLTF("/avatar/tutor.glb");
  const cloned = useMemo(() => SkeletonUtils.clone(scene), [scene]);

  const { actions, names } = useAnimations(animations, groupRef);

  useLayoutEffect(() => {
    const box = new THREE.Box3().setFromObject(cloned);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();

    box.getSize(size);
    box.getCenter(center);

    cloned.position.x = -center.x;
    cloned.position.y = -box.min.y - size.y * 0.14;
    cloned.rotation.set(0, 0.35, 0);

    const cam = camera as THREE.PerspectiveCamera;
    cam.position.set(0, size.y * 0.9, size.y * 2.9);
    cam.lookAt(0, size.y * 0.52, 0);
    cam.updateProjectionMatrix();

    cloned.updateMatrixWorld(true);
  }, [cloned, camera]);

  useEffect(() => {
    if (!names.length) return;

    const preferred =
      names.find((name) => /idle|stand|breath|talk|greet/i.test(name)) ?? names[0];

    const action = actions[preferred];
    if (!action) return;

    action.reset().fadeIn(0.2).play();

    return () => {
      action.fadeOut(0.2);
    };
  }, [actions, names]);

  useEffect(() => {
    let foundHead: THREE.Object3D | null = null;

    cloned.traverse((obj) => {
      const n = (obj.name || "").toLowerCase();
      if (!foundHead && n.includes("head")) {
        foundHead = obj;
      }
    });

    headRef.current = foundHead;
  }, [cloned]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();

    if (headRef.current) {
      if (speaking) {
        headRef.current.rotation.x = 0.02 * Math.sin(t * 7);
        headRef.current.rotation.y = 0.015 * Math.sin(t * 4);
      } else {
        headRef.current.rotation.x *= 0.82;
        headRef.current.rotation.y *= 0.82;
      }
    }
  });

  return (
    <group ref={groupRef}>
      <primitive object={cloned} scale={0.9} />
    </group>
  );
}

export default function TutorAvatar3D({
  height = 760,
  speaking = false,
}: TutorAvatar3DProps) {
  return (
    <div
      style={{
        width: "100%",
        height,
        minHeight: 620,
        borderRadius: 20,
        overflow: "hidden",
        background: "#eef3f9",
      }}
    >
      <Canvas camera={{ position: [0, 2, 8], fov: 24 }}>
        <ambientLight intensity={1.1} />
        <directionalLight position={[2.5, 4, 3]} intensity={1.6} />
        <directionalLight position={[-2, 2, 2]} intensity={0.85} />

        <Suspense fallback={null}>
          <AvatarModel speaking={speaking} />
          <Environment preset="studio" />
        </Suspense>
      </Canvas>
    </div>
  );
}

useGLTF.preload("/avatar/tutor.glb");