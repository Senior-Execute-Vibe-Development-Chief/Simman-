import { useEffect, useRef } from "react";
import {
  Scene, PerspectiveCamera, WebGLRenderer,
  SphereGeometry, MeshPhongMaterial, Mesh,
  CanvasTexture, AmbientLight, DirectionalLight, Color,
  BackSide, ShaderMaterial, AdditiveBlending
} from "three";

export default function GlobeView({ terrainBuf, world, show3D, CW, CH }) {
  const containerRef = useRef(null);
  const stateRef = useRef(null);

  // Setup scene once
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const scene = new Scene();
    scene.background = new Color(0x060810);
    const camera = new PerspectiveCamera(45, el.clientWidth / el.clientHeight, 0.01, 100);
    camera.position.set(0, 0, 2.6);

    const renderer = new WebGLRenderer({ antialias: true });
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);

    // Sphere geometry — high enough segments for visible terrain
    const baseGeo = new SphereGeometry(1, 256, 128);
    const geo = baseGeo.clone();

    // Offscreen canvas for texture
    const texCanvas = document.createElement("canvas");
    texCanvas.width = CW;
    texCanvas.height = CH;
    const texCtx = texCanvas.getContext("2d");
    const texture = new CanvasTexture(texCanvas);

    const mat = new MeshPhongMaterial({
      map: texture,
      shininess: 8,
      specular: new Color(0x222222),
    });
    const mesh = new Mesh(geo, mat);
    scene.add(mesh);

    // Lighting — warm sun + cool fill for depth and contrast
    const ambient = new AmbientLight(0x8090b0, 0.5); // cool blue-ish fill
    scene.add(ambient);
    const sun = new DirectionalLight(0xfff0e0, 1.2); // warm sunlight, strong
    sun.position.set(3, 2, 4);
    scene.add(sun);
    const fill = new DirectionalLight(0x4060a0, 0.3); // cool blue rim
    fill.position.set(-3, -1, -2);
    scene.add(fill);

    // Atmosphere glow — a slightly larger sphere with a rim-light shader
    const atmosGeo = new SphereGeometry(1.015, 64, 32);
    const atmosMat = new ShaderMaterial({
      vertexShader: `
        varying vec3 vWorldPos;
        varying vec3 vNormal;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vWorldPos = (modelViewMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vWorldPos;
        varying vec3 vNormal;
        void main() {
          vec3 viewDir = normalize(-vWorldPos);
          float rim = 1.0 - max(0.0, dot(vNormal, viewDir));
          float intensity = pow(rim, 2.0);
          gl_FragColor = vec4(0.35, 0.55, 1.0, intensity * 0.55);
        }
      `,
      blending: AdditiveBlending,
      side: BackSide,
      transparent: true,
      depthWrite: false,
    });
    const atmosMesh = new Mesh(atmosGeo, atmosMat);
    scene.add(atmosMesh);

    // Interaction state
    let dragging = false, prevX = 0, prevY = 0;
    let rotX = 0.3, rotY = 0; // slight tilt to show northern hemisphere
    let zoom = 2.6;
    let autoRot = true;

    const onDown = (e) => { dragging = true; autoRot = false; prevX = e.clientX; prevY = e.clientY; };
    const onUp = () => { dragging = false; };
    const onMove = (e) => {
      if (!dragging) return;
      const dx = e.clientX - prevX, dy = e.clientY - prevY;
      rotY += dx * 0.005;
      rotX += dy * 0.005;
      rotX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, rotX));
      prevX = e.clientX; prevY = e.clientY;
    };
    const onWheel = (e) => {
      e.preventDefault();
      zoom = Math.max(1.4, Math.min(5, zoom + e.deltaY * 0.002));
    };

    renderer.domElement.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointermove", onMove);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });

    // Resize handler
    const onResize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);

    // Animation loop
    let animId;
    const loop = () => {
      animId = requestAnimationFrame(loop);
      if (autoRot) rotY += 0.003;
      mesh.rotation.set(rotX, rotY, 0, "YXZ");
      atmosMesh.rotation.set(rotX, rotY, 0, "YXZ");
      camera.position.z = zoom;
      renderer.render(scene, camera);
    };
    animId = requestAnimationFrame(loop);

    stateRef.current = { scene, camera, renderer, mesh, geo, baseGeo, texture, texCanvas, texCtx, mat };

    return () => {
      cancelAnimationFrame(animId);
      renderer.domElement.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointermove", onMove);
      renderer.domElement.removeEventListener("wheel", onWheel);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
      geo.dispose();
      baseGeo.dispose();
      mat.dispose();
      texture.dispose();
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement);
    };
  }, []);

  // Update texture when terrain cache changes
  useEffect(() => {
    const s = stateRef.current;
    if (!s || !terrainBuf) return;
    const { texCtx, texCanvas, texture } = s;
    const img = texCtx.createImageData(CW, CH);
    const d = img.data;
    // Boost saturation + contrast for 3D rendering (lighting washes out flat colors)
    for (let i = 0; i < CW * CH; i++) {
      const i3 = i * 3, i4 = i * 4;
      let r = terrainBuf[i3], g = terrainBuf[i3 + 1], b = terrainBuf[i3 + 2];
      // Saturation boost: push channels away from gray
      const gray = (r + g + b) / 3;
      const sat = 1.3; // 30% more saturated
      r = Math.max(0, Math.min(255, gray + (r - gray) * sat));
      g = Math.max(0, Math.min(255, gray + (g - gray) * sat));
      b = Math.max(0, Math.min(255, gray + (b - gray) * sat));
      // Slight contrast boost
      r = Math.max(0, Math.min(255, (r - 128) * 1.1 + 128));
      g = Math.max(0, Math.min(255, (g - 128) * 1.1 + 128));
      b = Math.max(0, Math.min(255, (b - 128) * 1.1 + 128));
      d[i4] = r; d[i4 + 1] = g; d[i4 + 2] = b; d[i4 + 3] = 255;
    }
    texCtx.putImageData(img, 0, 0);
    texture.needsUpdate = true;
  }, [terrainBuf, CW, CH]);

  // Update vertex displacement when world or show3D changes
  useEffect(() => {
    const s = stateRef.current;
    if (!s || !world) return;
    const { geo, baseGeo } = s;
    const W = world.width || 1920, H = world.height || 960;
    const elev = world.elevation;

    // Reset to base positions
    const basePos = baseGeo.attributes.position;
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setXYZ(i, basePos.getX(i), basePos.getY(i), basePos.getZ(i));
    }

    if (show3D && elev) {
      const exaggeration = 0.08; // height scale relative to radius=1
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const r = Math.sqrt(x * x + y * y + z * z);
        if (r < 0.001) continue;
        // Spherical to UV
        const theta = Math.atan2(x, z); // longitude
        const phi = Math.asin(Math.max(-1, Math.min(1, y / r))); // latitude
        const u = (theta / (2 * Math.PI) + 0.5) % 1;
        const v = 0.5 - phi / Math.PI; // v=0 at north pole, v=1 at south
        // Sample elevation
        const ex = Math.floor(u * W) % W;
        const ey = Math.max(0, Math.min(H - 1, Math.floor(v * H)));
        const e = elev[ey * W + ex];
        const disp = Math.max(0, e) * exaggeration;
        // Push outward along normal (which is just the normalized position for a sphere)
        const invR = 1 / r;
        pos.setX(i, x + x * invR * disp);
        pos.setY(i, y + y * invR * disp);
        pos.setZ(i, z + z * invR * disp);
      }
    }

    pos.needsUpdate = true;
    geo.computeVertexNormals();
  }, [world, show3D]);

  return (
    <div ref={containerRef} style={{
      width: "100%", height: "100%", position: "relative",
      background: "#060810", cursor: "grab"
    }} />
  );
}
