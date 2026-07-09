"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

declare global {
  interface Window {
    __reactor?: { setMode: (m: string) => void };
  }
}

// Ported from the prototype's initReactor() — the animated WebGL background.
export default function Reactor({ accent = "#FB7250" }: { accent?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    } catch {
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x06070a, 0.017);
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 130);
    camera.position.set(0, 0, 17);
    const resize = () => {
      const w = window.innerWidth,
        h = window.innerHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    window.addEventListener("resize", resize);

    const accentC = new THREE.Color(accent);
    const blue = new THREE.Color("#5B9DFF");

    const dotCanvas = document.createElement("canvas");
    dotCanvas.width = dotCanvas.height = 128;
    const dctx = dotCanvas.getContext("2d")!;
    const dg = dctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    dg.addColorStop(0, "rgba(255,255,255,1)");
    dg.addColorStop(0.62, "rgba(255,255,255,1)");
    dg.addColorStop(0.78, "rgba(255,255,255,0.7)");
    dg.addColorStop(1, "rgba(255,255,255,0)");
    dctx.fillStyle = dg;
    dctx.beginPath();
    dctx.arc(64, 64, 64, 0, Math.PI * 2);
    dctx.fill();
    const dotTex = new THREE.CanvasTexture(dotCanvas);
    dotTex.needsUpdate = true;
    dotTex.minFilter = THREE.LinearFilter;
    dotTex.magFilter = THREE.LinearFilter;

    const N = 2600;
    const posArr = new Float32Array(N * 3),
      colArr = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const r = 7 + Math.random() * 24,
        th = Math.random() * Math.PI * 2,
        ph = Math.acos(2 * Math.random() - 1);
      posArr[i * 3] = r * Math.sin(ph) * Math.cos(th) * 1.5;
      posArr[i * 3 + 1] = (Math.random() - 0.5) * 26;
      posArr[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th) - 6;
      const c = accentC.clone().lerp(blue, Math.random() * 0.75);
      colArr[i * 3] = c.r;
      colArr[i * 3 + 1] = c.g;
      colArr[i * 3 + 2] = c.b;
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute("position", new THREE.BufferAttribute(posArr, 3));
    pg.setAttribute("color", new THREE.BufferAttribute(colArr, 3));
    const points = new THREE.Points(
      pg,
      new THREE.PointsMaterial({
        size: 0.19,
        vertexColors: true,
        map: dotTex,
        alphaTest: 0.12,
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
      })
    );
    scene.add(points);

    const streakN = 90;
    const streakPos = new Float32Array(streakN * 3),
      streakCol = new Float32Array(streakN * 3);
    for (let i = 0; i < streakN; i++) {
      const r = 6 + Math.random() * 22,
        th = Math.random() * Math.PI * 2;
      streakPos[i * 3] = Math.cos(th) * r;
      streakPos[i * 3 + 1] = (Math.random() - 0.5) * 24;
      streakPos[i * 3 + 2] = Math.sin(th) * r - 6;
      const c = Math.random() > 0.5 ? accentC.clone() : blue.clone();
      streakCol[i * 3] = c.r;
      streakCol[i * 3 + 1] = c.g;
      streakCol[i * 3 + 2] = c.b;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.BufferAttribute(streakPos, 3));
    sg.setAttribute("color", new THREE.BufferAttribute(streakCol, 3));
    const streaks = new THREE.Points(
      sg,
      new THREE.PointsMaterial({
        size: 0.36,
        vertexColors: true,
        map: dotTex,
        alphaTest: 0.12,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
      })
    );
    scene.add(streaks);

    const core = new THREE.Group();
    core.position.set(8.5, 4.2, -1);
    scene.add(core);
    const ico = new THREE.Mesh(
      new THREE.IcosahedronGeometry(3.2, 1),
      new THREE.MeshBasicMaterial({
        color: accentC.clone(),
        wireframe: true,
        transparent: true,
        opacity: 0.72,
      })
    );
    const outer = new THREE.Mesh(
      new THREE.IcosahedronGeometry(5.2, 1),
      new THREE.MeshBasicMaterial({
        color: blue.clone(),
        wireframe: true,
        transparent: true,
        opacity: 0.22,
      })
    );
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(2.6, 28, 28),
      new THREE.MeshBasicMaterial({ color: accentC.clone(), transparent: true, opacity: 0.32 })
    );
    core.add(ico);
    core.add(outer);
    core.add(glow);
    const sats: THREE.Sprite[] = [];
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: dotTex,
          color: i % 2 ? accentC.clone() : blue.clone(),
          transparent: true,
          opacity: 1,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          alphaTest: 0.1,
        })
      );
      s.scale.set(0.4, 0.4, 1);
      s.userData = { orb: 3.7 + i * 0.42, sp: 0.35 + i * 0.15, ph: i * 1.25 };
      core.add(s);
      sats.push(s);
    }

    const green = new THREE.Color("#35D6A4");
    const stt = { speed: 1, target: 1, flash: 0 };
    window.__reactor = {
      setMode(m: string) {
        if (m === "running") stt.target = 3.6;
        else if (m === "completed") {
          stt.target = 1;
          stt.flash = 1;
        } else stt.target = 1;
      },
    };

    let mx = 0,
      my = 0;
    const onMove = (e: PointerEvent) => {
      mx = e.clientX / window.innerWidth - 0.5;
      my = e.clientY / window.innerHeight - 0.5;
    };
    window.addEventListener("pointermove", onMove);

    const timer = new THREE.Timer();
    let raf = 0;
    const tick = () => {
      timer.update();
      const t = timer.getElapsed();
      stt.speed += (stt.target - stt.speed) * 0.045;
      points.rotation.y = t * 0.06 * stt.speed;
      points.rotation.x = Math.sin(t * 0.08) * 0.18;
      streaks.rotation.y = -t * 0.1 * stt.speed;
      streaks.rotation.z = t * 0.02;
      core.rotation.y += 0.011 * stt.speed;
      core.rotation.x += 0.006 * stt.speed;
      core.position.y = 4.2 + Math.sin(t * 0.55) * 0.7;
      outer.rotation.y -= 0.0075 * stt.speed;
      outer.rotation.x += 0.0038 * stt.speed;
      ico.scale.setScalar(1 + Math.sin(t * 2.2) * 0.08 * stt.speed);
      (points.material as THREE.PointsMaterial).opacity = 0.9 + Math.sin(t * 1.4) * 0.1;
      (streaks.material as THREE.PointsMaterial).size =
        0.5 + Math.sin(t * 3) * 0.15 + (stt.speed - 1) * 0.25;
      for (let i = 0; i < sats.length; i++) {
        const u = sats[i].userData as { orb: number; sp: number; ph: number };
        const a = t * u.sp * stt.speed * 1.6 + u.ph;
        sats[i].position.set(Math.cos(a) * u.orb, Math.sin(a * 1.3) * 1.3, Math.sin(a) * u.orb);
      }
      const glowMat = glow.material as THREE.MeshBasicMaterial;
      const icoMat = ico.material as THREE.MeshBasicMaterial;
      glowMat.opacity = 0.34 + Math.sin(t * 2.2) * 0.1 + (stt.speed - 1) * 0.09;
      if (stt.flash > 0.02) {
        stt.flash *= 0.945;
        glowMat.color.lerp(green, 0.25);
        icoMat.color.lerp(green, 0.12);
      } else {
        glowMat.color.lerp(accentC, 0.06);
        icoMat.color.lerp(accentC, 0.06);
      }
      camera.position.x += (mx * 4.6 + Math.sin(t * 0.13) * 2.3 - camera.position.x) * 0.035;
      camera.position.y += (-my * 3.2 + Math.cos(t * 0.11) * 1.4 - camera.position.y) * 0.035;
      camera.lookAt(2, 1, -3);
      renderer.render(scene, camera);
      raf = requestAnimationFrame(tick);
    };
    tick();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      renderer.dispose();
      delete window.__reactor;
    };
  }, [accent]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        zIndex: 0,
        pointerEvents: "none",
      }}
    />
  );
}
