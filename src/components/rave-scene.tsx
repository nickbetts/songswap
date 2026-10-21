"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { toast } from "sonner";

export default function RaveScene({ animate }: { animate: boolean }) {
  const mount = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const host = mount.current;
    if (!host || failed) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, powerPreference: "low-power" });
    } catch (error) {
      console.warn("Rave mode: WebGL unavailable", error);
      setFailed(true);
      toast.info("3D isn't available on this device. Keeping the neon lighting instead");
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, window.innerWidth < 700 ? 1 : 1.5));
    renderer.setClearColor(0x000000, 0);
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x080414, 0.038);
    const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 70);
    camera.position.set(0, 1, 13);
    camera.lookAt(0, 0, -5);
    const stage = new THREE.Group();
    scene.add(stage);
    scene.add(new THREE.AmbientLight(0x8c71ff, 2));

    const palette = [0xff3dbb, 0x33eaff, 0xab66ff, 0xffb957];
    const lights = palette.map((color, i) => {
      const light = new THREE.PointLight(color, 130, 24, 1.5);
      light.position.set((i % 2 ? 1 : -1) * 5, 4, i < 2 ? 4 : -6);
      scene.add(light);
      return light;
    });

    const ball = new THREE.Group();
    ball.position.set(5.5, 4, -4);
    stage.add(ball);
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(1.22, 32, 24),
      new THREE.MeshStandardMaterial({ color: 0x46435b, metalness: 0.6, roughness: 0.3 }),
    );
    ball.add(core);
    const tileGeometry = new THREE.BoxGeometry(0.11, 0.11, 0.024);
    const tileMaterial = new THREE.MeshStandardMaterial({
      color: 0xd6e9ff, metalness: 0.55, roughness: 0.24,
      emissive: 0x6f4fad, emissiveIntensity: 0.45,
    });
    const tiles = new THREE.InstancedMesh(tileGeometry, tileMaterial, 28 * 56);
    const dummy = new THREE.Object3D();
    let count = 0;
    for (let row = 0; row < 28; row++) {
      const phi = (row + 0.5) / 28 * Math.PI;
      for (let col = 0; col < 56; col++) {
        const theta = col / 56 * Math.PI * 2;
        dummy.position.set(
          1.25 * Math.sin(phi) * Math.cos(theta),
          1.25 * Math.cos(phi),
          1.25 * Math.sin(phi) * Math.sin(theta),
        );
        dummy.lookAt(dummy.position.clone().multiplyScalar(2));
        dummy.updateMatrix();
        tiles.setMatrixAt(count++, dummy.matrix);
      }
    }
    ball.add(tiles);
    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(1.7, 0.012, 6, 100),
      new THREE.MeshBasicMaterial({ color: 0x57ecff, transparent: true, opacity: 0.6 }),
    );
    halo.rotation.x = 0.6;
    halo.rotation.y = 0.3;
    ball.add(halo);

    const portals = palette.slice(0, 3).map((color, i) => {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(3.5 + i * 0.48, 0.018, 6, 120),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45 - i * 0.08 }),
      );
      ring.position.set(-3.5, -0.4, -8 - i * 2);
      ring.rotation.set(0.3, 0.25, i * 0.4);
      stage.add(ring);
      return ring;
    });

    const grid = new THREE.GridHelper(70, 48, 0xc24cff, 0x352358);
    grid.position.y = -3.5;
    const gridMaterial = grid.material;
    if (!Array.isArray(gridMaterial)) {
      gridMaterial.transparent = true;
      gridMaterial.opacity = 0.46;
    }
    stage.add(grid);
    const floorRings = palette.slice(0, 3).map((color, i) => {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(4 + i * 2.1, 0.014, 6, 100),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25 }),
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.set(0, -3.45, -6);
      stage.add(ring);
      return ring;
    });

    const beams = Array.from({ length: 6 }, (_, i) => {
      const pivot = new THREE.Group();
      pivot.position.set(i % 2 ? 7 : -7, 6, -5 - Math.floor(i / 2) * 4);
      const geometry = new THREE.ConeGeometry(2, 14, 24, 1, true);
      geometry.translate(0, -7, 0);
      const beam = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
        color: palette[i % palette.length], transparent: true, opacity: 0.05,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      pivot.add(beam);
      stage.add(pivot);
      return pivot;
    });

    const positions = new Float32Array(240 * 3);
    for (let i = 0; i < positions.length; i++) {
      positions[i] = Math.sin(i * 127.1 + 311.7) * (i % 3 === 2 ? 18 : 12);
    }
    const particleGeometry = new THREE.BufferGeometry();
    particleGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const dust = new THREE.Points(particleGeometry, new THREE.PointsMaterial({
      color: 0x9aefff, size: 0.035, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    stage.add(dust);

    let frame = 0;
    let lastFrame = 0;
    let elapsed = 0;
    let lastTime = 0;
    const moving = animate && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    function draw(time: number) {
      if (document.hidden) return;
      if (moving) frame = requestAnimationFrame(draw);
      if (moving && time - lastFrame < 1000 / 30) return;
      elapsed += lastTime ? Math.min((time - lastTime) / 1000, 0.1) : 0;
      lastTime = time;
      lastFrame = time;
      const t = elapsed;
      ball.rotation.y = t * 0.13;
      halo.rotation.z = t * 0.09;
      portals.forEach((ring, i) => {
        ring.rotation.y = 0.25 + Math.sin(t * 0.17 + i) * 0.3;
        ring.rotation.z = t * 0.045 * (i % 2 ? -1 : 1);
      });
      beams.forEach((beam, i) => {
        beam.rotation.z = (i % 2 ? -1 : 1) * (0.4 + Math.sin(t * 0.24 + i) * 0.4);
        beam.rotation.x = Math.sin(t * 0.16 + i * 1.3) * 0.35;
      });
      lights.forEach((light, i) => {
        light.position.x = Math.sin(t * 0.3 + i * 1.7) * 6;
      });
      dust.rotation.y = t * 0.015;
      floorRings.forEach((ring, i) => { ring.position.y = -3.45 + Math.sin(t * 0.4 + i) * 0.04; });
      renderer.render(scene, camera);
    }
    function resize() {
      const width = host!.clientWidth;
      const height = host!.clientHeight;
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
      if (!moving) draw(0);
    }
    function visibility() {
      cancelAnimationFrame(frame);
      lastTime = 0;
      if (!document.hidden) draw(performance.now());
    }
    function contextLost(event: Event) {
      event.preventDefault();
      console.warn("Rave mode: WebGL context lost");
      toast.info("3D lighting paused by your device. Neon lighting is still on");
      setFailed(true);
    }
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    renderer.domElement.addEventListener("webglcontextlost", contextLost);
    document.addEventListener("visibilitychange", visibility);
    resize();
    if (moving) draw(performance.now());
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("visibilitychange", visibility);
      renderer.domElement.removeEventListener("webglcontextlost", contextLost);
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.LineSegments) {
          geometries.add(object.geometry);
          const list = Array.isArray(object.material) ? object.material : [object.material];
          list.forEach((material) => materials.add(material));
        }
        if (object instanceof THREE.InstancedMesh) object.dispose();
      });
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [animate, failed]);

  return <div ref={mount} className="rave-canvas" aria-hidden="true" />;
}
