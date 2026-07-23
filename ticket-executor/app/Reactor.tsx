"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";

declare global {
  interface Window {
    __reactor?: { setMode: (m: string) => void; setFrozen: (frozen: boolean) => void };
  }
}

// Ported from the prototype's initReactor() — the animated WebGL background.
export default function Reactor({ accent = "#FB7250", frozen = false }: { accent?: string; frozen?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frozenRef = useRef(frozen);
  frozenRef.current = frozen;

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
    const lineMaterials: LineMaterial[] = [];
    const resize = () => {
      const w = window.innerWidth,
        h = window.innerHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      for (const m of lineMaterials) m.resolution.set(w, h);
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

    // Sharper, tighter-falloff texture for the tiny orbiting satellites (the
    // shared dotTex above is tuned for soft, larger starfield points and
    // reads as blurry at satellite scale).
    const satCanvas = document.createElement("canvas");
    satCanvas.width = satCanvas.height = 256;
    const sctx = satCanvas.getContext("2d")!;
    const sg2 = sctx.createRadialGradient(128, 128, 0, 128, 128, 128);
    sg2.addColorStop(0, "rgba(255,255,255,1)");
    sg2.addColorStop(0.42, "rgba(255,255,255,1)");
    sg2.addColorStop(0.58, "rgba(255,255,255,0.85)");
    sg2.addColorStop(0.82, "rgba(255,255,255,0.15)");
    sg2.addColorStop(1, "rgba(255,255,255,0)");
    sctx.fillStyle = sg2;
    sctx.beginPath();
    sctx.arc(128, 128, 128, 0, Math.PI * 2);
    sctx.fill();
    const satTex = new THREE.CanvasTexture(satCanvas);
    satTex.needsUpdate = true;
    satTex.minFilter = THREE.LinearFilter;
    satTex.magFilter = THREE.LinearFilter;
    satTex.anisotropy = 4;

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
    const white = new THREE.Color("#EAF3FF");
    const icoBright = accentC.clone().lerp(white, 0.32);
    // Inner facet cage: EdgesGeometry on a plain (non-subdivided) icosahedron
    // gives just its ~30 real edges (no internal subdivision diagonals), and
    // LineMaterial renders them at a real pixel linewidth — bold, clean
    // facets instead of a busy wireframe or a duplicated-line hack.
    function boldEdges(radius: number, color: THREE.Color, linewidth: number, opacity: number) {
      const edges = new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(radius, 0));
      const geo = new LineSegmentsGeometry().setPositions(edges.attributes.position.array as Float32Array);
      const mat = new LineMaterial({ color: color.getHex(), linewidth, transparent: true, opacity, depthWrite: false });
      mat.resolution.set(window.innerWidth, window.innerHeight);
      lineMaterials.push(mat);
      return new LineSegments2(geo, mat);
    }
    const ico = boldEdges(3.2, icoBright, 2.6, 0.95);

    // Outer shell: a wireframe cage of straight edges never reads as a round
    // mass — you see every far-side line right through the near side, so it
    // stays a flat tangle no matter how many facets it has. Swap it for an
    // actual curved surface: a Fresnel-shaded sphere that's transparent head
    // -on and glows at its silhouette, which is the real visual cue for "this
    // is a round volume" (same trick used for planet atmospheres/energy
    // shields), colored with the brand accent so it matches instead of clashing.
    // The rim trembles as a coherent brightness shimmer around its
    // circumference (angle-based, not per-vertex position displacement —
    // displacing the actual geometry read as lopsided lumps that broke the
    // round silhouette and threw the core off-center relative to it). Its
    // color drifts slowly and gently through orange → bright red → yellow.
    const outerMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uFlash: { value: 0 },
        // Higher power = a narrower, crisper falloff band instead of a soft,
        // smeared-looking gradient — keeps the color reading clean/defined.
        uPower: { value: 3.4 },
        uIntensity: { value: 1.9 },
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vViewDir;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
          vViewDir = normalize(-mvPos.xyz);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uFlash;
        uniform float uPower;
        uniform float uIntensity;
        varying vec3 vNormal;
        varying vec3 vViewDir;
        void main() {
          vec3 orangeC = vec3(1.0, 0.42, 0.20);
          vec3 redC = vec3(1.0, 0.14, 0.10);
          vec3 yellowC = vec3(1.0, 0.80, 0.28);
          float cyc = mod(uTime * 0.09, 3.0);
          vec3 cycling = cyc < 1.0 ? mix(orangeC, redC, cyc)
                        : cyc < 2.0 ? mix(redC, yellowC, cyc - 1.0)
                        : mix(yellowC, orangeC, cyc - 2.0);
          vec3 flashC = vec3(1.0, 0.78, 0.5);
          vec3 col = mix(cycling, flashC, uFlash);
          vec3 n = normalize(vNormal);
          float ang = atan(n.y, n.x);
          float shimmer = 0.88 + 0.12 * sin(ang * 5.0 + uTime * 2.4) * sin(uTime * 3.1);
          float rim = pow(1.0 - max(dot(n, normalize(vViewDir)), 0.0), uPower);
          gl_FragColor = vec4(col, rim * uIntensity * shimmer);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const outer = new THREE.Mesh(new THREE.SphereGeometry(5.6, 64, 48), outerMat);

    // Core "loading sphere" — an exact recreation of the app's own
    // LoadingRing spinner (LoadingRing.tsx): the same off-center
    // radial-gradient core and the same two conic-gradient rings, all
    // rendered as camera-facing sprites so they read as the flat 2D icon
    // from any viewing angle, instead of being smeared across a 3D sphere.
    const hex = (c: THREE.Color) => "#" + c.getHexString();
    const CORE_D = 2.6;
    const CORE_TEX_SIZE = 640;
    const coreCanvas = document.createElement("canvas");
    coreCanvas.width = coreCanvas.height = CORE_TEX_SIZE;
    const cctx = coreCanvas.getContext("2d")!;
    const cc = CORE_TEX_SIZE / 2;
    const coreGrad = cctx.createRadialGradient(cc * 0.68, cc * 0.64, 0, cc * 0.68, cc * 0.64, cc * 0.95);
    coreGrad.addColorStop(0, "#FFF3EA");
    coreGrad.addColorStop(0.14, "#FFC15E");
    coreGrad.addColorStop(0.4, hex(accentC));
    coreGrad.addColorStop(0.62, "rgba(251,114,80,.75)");
    coreGrad.addColorStop(0.8, "rgba(251,114,80,0)");
    cctx.fillStyle = coreGrad;
    cctx.beginPath();
    cctx.arc(cc, cc, cc * 0.985, 0, Math.PI * 2);
    cctx.fill();
    const coreTex = new THREE.CanvasTexture(coreCanvas);
    coreTex.needsUpdate = true;
    coreTex.generateMipmaps = false;
    coreTex.minFilter = THREE.LinearFilter;
    coreTex.magFilter = THREE.LinearFilter;
    const coreSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: coreTex, transparent: true, opacity: 1, depthWrite: false })
    );
    coreSprite.scale.setScalar(CORE_D);
    const coreHaze = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: satTex,
        color: accentC.clone(),
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    coreHaze.scale.setScalar(CORE_D * 2.4);

    function buildRingSpriteTex(mode: "soft" | "ticks") {
      const size = 512;
      const rc = document.createElement("canvas");
      rc.width = rc.height = size;
      const rctx = rc.getContext("2d")!;
      const cx = size / 2,
        cy = size / 2;
      const outerR = size * 0.47,
        thickness = size * 0.09;
      const midR = outerR - thickness / 2;
      const ticks: [number, number][] = [[0, 8], [42, 50], [92, 100], [180, 188], [230, 238]];
      const steps = 360;
      for (let d = 0; d < steps; d++) {
        let a = 0;
        if (mode === "soft") {
          const frac = d / steps;
          a = frac < 0.55 ? Math.sin((frac / 0.55) * Math.PI) : 0;
        } else {
          a = ticks.some(([s, e]) => d >= s && d < e) ? 1 : 0;
        }
        if (a <= 0) continue;
        const a0 = (d / steps) * Math.PI * 2 - Math.PI / 2;
        const a1 = ((d + 1) / steps) * Math.PI * 2 - Math.PI / 2;
        rctx.beginPath();
        rctx.arc(cx, cy, midR, a0, a1);
        rctx.lineWidth = thickness;
        rctx.strokeStyle = `rgba(255,255,255,${a})`;
        rctx.stroke();
      }
      const tex = new THREE.CanvasTexture(rc);
      tex.needsUpdate = true;
      tex.generateMipmaps = false;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      return tex;
    }
    // Outer ring: soft comet band (LoadingRing's 3.2s conic ring). Inner ring:
    // 5-tick faceted band (its 2.1s-reverse counter-rotating ring). Diameters
    // follow the same 96/60/34px ratios as the CSS spinner.
    const ringOuterA = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: buildRingSpriteTex("soft"),
        color: accentC.clone(),
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    ringOuterA.scale.setScalar(CORE_D * 2.824);
    const ringInnerA = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: buildRingSpriteTex("ticks"),
        color: white.clone(),
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    ringInnerA.scale.setScalar(CORE_D * 1.765);

    const loader = new THREE.Group();
    loader.add(ringOuterA);
    loader.add(ringInnerA);
    loader.add(coreHaze);
    loader.add(coreSprite);
    core.add(ico);
    core.add(outer);
    core.add(loader);
    const SAT_SCALE = 0.11;
    const sats: THREE.Sprite[] = [];
    for (let i = 0; i < 10; i++) {
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: satTex,
          color: i % 2 ? accentC.clone() : blue.clone(),
          transparent: true,
          opacity: 1,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          alphaTest: 0.05,
        })
      );
      s.scale.set(SAT_SCALE, SAT_SCALE, 1);
      s.userData = { orb: 3.7 + i * 0.28, sp: 0.32 + i * 0.11, ph: i * 0.85, tilt: (i % 3) * 0.9 };
      core.add(s);
      sats.push(s);
    }

    // Lightning: jagged filaments crackling inside/around the icosahedron.
    const BOLT_N = 9;
    const BOLT_R = 3.0;
    function randPointOnSphere(r: number) {
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      return new THREE.Vector3(r * Math.sin(ph) * Math.cos(th), r * Math.sin(ph) * Math.sin(th), r * Math.cos(ph));
    }
    function boltPath() {
      const a = randPointOnSphere(BOLT_R * (0.55 + Math.random() * 0.4));
      const b = randPointOnSphere(BOLT_R * (0.55 + Math.random() * 0.4));
      const segs = 5;
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= segs; i++) {
        const p = a.clone().lerp(b, i / segs);
        if (i > 0 && i < segs) {
          p.x += (Math.random() - 0.5) * 1.15;
          p.y += (Math.random() - 0.5) * 1.15;
          p.z += (Math.random() - 0.5) * 1.15;
        }
        pts.push(p);
      }
      return pts;
    }
    const bolts: THREE.Line[] = [];
    for (let i = 0; i < BOLT_N; i++) {
      const pts = boltPath();
      const bg = new THREE.BufferGeometry().setFromPoints(pts);
      const bm = new THREE.LineBasicMaterial({
        color: white.clone().lerp(accentC, Math.random() * 0.3),
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const line = new THREE.Line(bg, bm);
      line.userData = { life: Math.random(), maxLife: 0.35 + Math.random() * 0.5 };
      core.add(line);
      bolts.push(line);
    }

    const flash = accentC.clone().lerp(white, 0.6);
    const neutral = new THREE.Color(0xffffff);
    const stt = { speed: 1, target: 1, flash: 0 };
    window.__reactor = {
      setMode(m: string) {
        if (m === "running") stt.target = 3.6;
        else if (m === "completed") {
          stt.target = 1;
          stt.flash = 1;
        } else stt.target = 1;
      },
      setFrozen(f: boolean) {
        frozenRef.current = f;
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
      if (frozenRef.current) {
        raf = requestAnimationFrame(tick);
        return;
      }
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
      outerMat.uniforms.uTime.value = t;
      outerMat.uniforms.uIntensity.value = 1.7 + Math.sin(t * 1.8) * 0.3 + (stt.speed - 1) * 0.35;
      // Sprites ignore their own Object3D rotation (always camera-facing) —
      // spin comes from SpriteMaterial.rotation, an in-plane 2D twist, same
      // as LoadingRing's 3.2s / 2.1s-reverse conic-gradient rings. The core
      // sprite itself never spins, matching the CSS (it only pulses).
      (ringOuterA.material as THREE.SpriteMaterial).rotation += 0.012 * stt.speed;
      (ringInnerA.material as THREE.SpriteMaterial).rotation -= 0.018 * stt.speed;
      ico.scale.setScalar(1 + Math.sin(t * 2.2) * 0.08 * stt.speed);
      (points.material as THREE.PointsMaterial).opacity = 0.9 + Math.sin(t * 1.4) * 0.1;
      (streaks.material as THREE.PointsMaterial).size =
        0.5 + Math.sin(t * 3) * 0.15 + (stt.speed - 1) * 0.25;
      for (let i = 0; i < sats.length; i++) {
        const u = sats[i].userData as { orb: number; sp: number; ph: number; tilt: number };
        const a = t * u.sp * stt.speed * 1.6 + u.ph;
        sats[i].position.set(
          Math.cos(a) * u.orb,
          Math.sin(a + u.tilt) * u.orb * 0.4,
          Math.sin(a) * u.orb * Math.cos(u.tilt * 0.5)
        );
      }
      for (let i = 0; i < bolts.length; i++) {
        const line = bolts[i];
        const u = line.userData as { life: number; maxLife: number };
        u.life += 0.016 * (0.6 + stt.speed * 0.5);
        const f = u.life / u.maxLife;
        if (f >= 1) {
          u.life = 0;
          u.maxLife = 0.3 + Math.random() * 0.55;
          line.geometry.dispose();
          line.geometry = new THREE.BufferGeometry().setFromPoints(boltPath());
        }
        const mat = line.material as THREE.LineBasicMaterial;
        mat.opacity = Math.sin(f * Math.PI) * (0.85 + stt.speed * 0.35) * (Math.random() > 0.04 ? 1 : 0.2);
      }
      const coreMat = coreSprite.material as THREE.SpriteMaterial;
      const icoMat = ico.material as LineMaterial;
      coreMat.opacity = 0.9 + Math.sin(t * 2.2) * 0.08 + (stt.speed - 1) * 0.03;
      (coreHaze.material as THREE.SpriteMaterial).opacity = 0.34 + Math.sin(t * 2.2) * 0.1 + (stt.speed - 1) * 0.09;
      if (stt.flash > 0.02) {
        stt.flash *= 0.945;
        coreMat.color.lerp(flash, 0.25);
        icoMat.color.lerp(flash, 0.12);
      } else {
        coreMat.color.lerp(neutral, 0.06);
        icoMat.color.lerp(icoBright, 0.06);
      }
      outerMat.uniforms.uFlash.value += (stt.flash - outerMat.uniforms.uFlash.value) * 0.1;
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
