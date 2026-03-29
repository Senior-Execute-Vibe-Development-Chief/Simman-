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
    const baseGeo = new SphereGeometry(1, 512, 256);
    const geo = baseGeo.clone();

    // Offscreen canvas for texture
    const texCanvas = document.createElement("canvas");
    texCanvas.width = CW;
    texCanvas.height = CH;
    const texCtx = texCanvas.getContext("2d");
    const texture = new CanvasTexture(texCanvas);
    // Anisotropic filtering for sharper texture at oblique angles
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    texture.anisotropy = maxAniso;

    // Specular map: ocean is reflective, land is matte
    const specCanvas = document.createElement("canvas");
    specCanvas.width = CW;
    specCanvas.height = CH;
    const specCtx = specCanvas.getContext("2d");
    const specTexture = new CanvasTexture(specCanvas);

    const mat = new MeshPhongMaterial({
      map: texture,
      specularMap: specTexture,
      shininess: 25,
      specular: new Color(0x444448),
    });
    const mesh = new Mesh(geo, mat);
    scene.add(mesh);

    // Lighting — low ambient for dark terminator, strong sun for contrast
    const ambient = new AmbientLight(0x606878, 0.25); // very dim cool fill
    scene.add(ambient);
    const sun = new DirectionalLight(0xfff5e8, 1.4); // strong warm sunlight
    sun.position.set(3, 1.5, 4);
    scene.add(sun);

    // Atmosphere — thin subtle whitish-blue haze at the limb
    const atmosGeo = new SphereGeometry(1.012, 64, 32);
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
          float intensity = pow(rim, 3.5);
          gl_FragColor = vec4(0.55, 0.7, 1.0, intensity * 0.35);
        }
      `,
      blending: AdditiveBlending,
      side: BackSide,
      transparent: true,
      depthWrite: false,
    });
    const atmosMesh = new Mesh(atmosGeo, atmosMat);
    scene.add(atmosMesh);

    // Camera orbit state — camera moves around fixed globe + sun
    let dragging = false, prevX = 0, prevY = 0;
    let camTheta = 0; // horizontal angle (longitude)
    let camPhi = 0.3; // vertical angle (latitude), slight tilt
    let camDist = 2.6;
    let autoRot = true;

    const onDown = (e) => { dragging = true; autoRot = false; prevX = e.clientX; prevY = e.clientY; };
    const onUp = () => { dragging = false; };
    const onMove = (e) => {
      if (!dragging) return;
      const dx = e.clientX - prevX, dy = e.clientY - prevY;
      camTheta -= dx * 0.005;
      camPhi += dy * 0.005;
      camPhi = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, camPhi));
      prevX = e.clientX; prevY = e.clientY;
    };
    const onWheel = (e) => {
      e.preventDefault();
      camDist = Math.max(1.4, Math.min(5, camDist + e.deltaY * 0.002));
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
      if (autoRot) camTheta += 0.003;
      // Orbit camera around the globe (globe + sun stay fixed)
      camera.position.x = camDist * Math.sin(camTheta) * Math.cos(camPhi);
      camera.position.y = camDist * Math.sin(camPhi);
      camera.position.z = camDist * Math.cos(camTheta) * Math.cos(camPhi);
      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
    };
    animId = requestAnimationFrame(loop);

    stateRef.current = { scene, camera, renderer, mesh, geo, baseGeo, texture, texCanvas, texCtx, specTexture, specCanvas, specCtx, mat };

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
      specTexture.dispose();
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
      const sat = 1.1; // subtle saturation boost (not too vivid)
      r = Math.max(0, Math.min(255, gray + (r - gray) * sat));
      g = Math.max(0, Math.min(255, gray + (g - gray) * sat));
      b = Math.max(0, Math.min(255, gray + (b - gray) * sat));
      // Slight contrast boost
      r = Math.max(0, Math.min(255, (r - 128) * 1.05 + 128));
      g = Math.max(0, Math.min(255, (g - 128) * 1.05 + 128));
      b = Math.max(0, Math.min(255, (b - 128) * 1.05 + 128));
      d[i4] = r; d[i4 + 1] = g; d[i4 + 2] = b; d[i4 + 3] = 255;
    }
    texCtx.putImageData(img, 0, 0);
    texture.needsUpdate = true;

    // Build specular map: ocean = white (reflective), land = black (matte)
    if (world && world.elevation) {
      const { specCtx, specTexture } = s;
      const W2 = world.width || 1920, H2 = world.height || 960;
      // Resize specular canvas to match texture size
      s.specCanvas.width = CW;
      s.specCanvas.height = CH;
      const specImg = specCtx.createImageData(CW, CH);
      const sd = specImg.data;
      for (let ty = 0; ty < CH; ty++) for (let tx = 0; tx < CW; tx++) {
        // Map texture pixel to world data (may need scaling if sizes differ)
        const wx = Math.min(W2 - 1, Math.round(tx / CW * W2));
        const wy = Math.min(H2 - 1, Math.round(ty / CH * H2));
        const isOcean = world.elevation[wy * W2 + wx] <= 0;
        const v = isOcean ? 180 : 0;
        const i4 = (ty * CW + tx) * 4;
        sd[i4] = v; sd[i4 + 1] = v; sd[i4 + 2] = v; sd[i4 + 3] = 255;
      }
      specCtx.putImageData(specImg, 0, 0);
      specTexture.needsUpdate = true;
    }
  }, [terrainBuf, CW, CH, world]);

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
