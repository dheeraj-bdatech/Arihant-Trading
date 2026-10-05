'use client';

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { ProductSpecItem } from '@/lib/brochure-products';
import { 
  RotateCw, 
  Maximize2, 
  Scan, 
  Layers, 
  Eye, 
  Sparkles, 
  Activity, 
  ZoomIn, 
  ZoomOut,
  ShieldCheck,
  Radio,
  Cpu
} from 'lucide-react';

interface Equipment3DViewerProps {
  product: ProductSpecItem;
  className?: string;
}

export function Equipment3DViewer({ product, className = '' }: Equipment3DViewerProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [renderMode, setRenderMode] = useState<'standard' | 'wireframe' | 'xray'>('standard');
  const [isRotating, setIsRotating] = useState(true);
  const [activeHotspot, setActiveHotspot] = useState<string | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1);

  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const modelGroupRef = useRef<THREE.Group | null>(null);
  const laserRef = useRef<THREE.Mesh | null>(null);
  const materialsRef = useRef<THREE.Material[]>([]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // Scene
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // Camera
    const width = container.clientWidth || 800;
    const height = container.clientHeight || 450;
    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    camera.position.set(0, 2.2, 5.5);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    // Renderer with soft shadow and antialias
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    rendererRef.current = renderer;

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    // Subtle environment lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.0);
    keyLight.position.set(5, 8, 5);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x0f5e63, 1.8);
    rimLight.position.set(-6, 3, -5);
    scene.add(rimLight);

    const bottomGlow = new THREE.PointLight(0xf2b872, 1.0, 10);
    bottomGlow.position.set(0, -1, 0);
    scene.add(bottomGlow);

    // Studio Grid Floor
    const gridHelper = new THREE.GridHelper(10, 20, 0xdcd8ce, 0xece9e2);
    gridHelper.position.y = -1.2;
    scene.add(gridHelper);

    // Soft Shadow Plane
    const shadowGeo = new THREE.PlaneGeometry(8, 8);
    const shadowMat = new THREE.ShadowMaterial({ opacity: 0.15 });
    const shadowPlane = new THREE.Mesh(shadowGeo, shadowMat);
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.y = -1.19;
    shadowPlane.receiveShadow = true;
    scene.add(shadowPlane);

    // Model Container
    const modelGroup = new THREE.Group();
    scene.add(modelGroup);
    modelGroupRef.current = modelGroup;

    // Build Procedural 3D Model based on product.model3DType
    buildProceduralModel(modelGroup, product.model3DType, renderMode);

    // Dynamic Scanning Laser Plane (for X-ray / inspection mode)
    const laserGeo = new THREE.PlaneGeometry(4, 3);
    const laserMat = new THREE.MeshBasicMaterial({
      color: 0x0f5e63,
      transparent: true,
      opacity: 0.25,
      side: THREE.DoubleSide
    });
    const laserMesh = new THREE.Mesh(laserGeo, laserMat);
    laserMesh.rotation.x = Math.PI / 2;
    laserMesh.position.y = -1;
    laserMesh.visible = renderMode === 'xray';
    scene.add(laserMesh);
    laserRef.current = laserMesh;

    // Interaction Drag Controls
    let isDragging = false;
    let previousMousePosition = { x: 0, y: 0 };

    const onMouseDown = (e: MouseEvent) => {
      isDragging = true;
      previousMousePosition = { x: e.clientX, y: e.clientY };
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging || !modelGroupRef.current) return;
      const deltaX = e.clientX - previousMousePosition.x;
      const deltaY = e.clientY - previousMousePosition.y;

      modelGroupRef.current.rotation.y += deltaX * 0.01;
      modelGroupRef.current.rotation.x = Math.max(
        -0.4,
        Math.min(0.6, modelGroupRef.current.rotation.x + deltaY * 0.005)
      );

      previousMousePosition = { x: e.clientX, y: e.clientY };
    };

    const onMouseUp = () => {
      isDragging = false;
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (!cameraRef.current) return;
      const newFov = Math.max(25, Math.min(60, cameraRef.current.fov + e.deltaY * 0.05));
      cameraRef.current.fov = newFov;
      cameraRef.current.updateProjectionMatrix();
      setZoomLevel(Number(((40 / newFov)).toFixed(1)));
    };

    container.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    container.addEventListener('wheel', onWheel, { passive: false });

    // Animation Loop
    let animationFrameId: number;
    let clock = new THREE.Clock();

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      const elapsedTime = clock.getElapsedTime();

      // Idle Rotation
      if (isRotating && !isDragging && modelGroupRef.current) {
        modelGroupRef.current.rotation.y += 0.004;
      }

      // Laser Scanner Animation
      if (laserRef.current && laserRef.current.visible) {
        laserRef.current.position.y = Math.sin(elapsedTime * 2.5) * 1.0 + 0.1;
      }

      // Articulated secondary motion (e.g. Robot arm or radar sweep)
      const animatedPart = modelGroup.getObjectByName('animatedPart');
      if (animatedPart) {
        animatedPart.rotation.y = Math.sin(elapsedTime * 1.5) * 0.4;
      }

      renderer.render(scene, camera);
    };

    animate();

    // Resize Handler
    const handleResize = () => {
      if (!container || !rendererRef.current || !cameraRef.current) return;
      const newWidth = container.clientWidth;
      const newHeight = container.clientHeight;
      cameraRef.current.aspect = newWidth / newHeight;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(newWidth, newHeight);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
      container.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      container.removeEventListener('wheel', onWheel);
      renderer.dispose();
    };
  }, [product.id]);

  // Update render mode (wireframe / standard / xray)
  useEffect(() => {
    if (!modelGroupRef.current) return;
    
    // Rebuild or re-skin
    modelGroupRef.current.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach(m => applyModeToMaterial(m, renderMode));
          } else {
            applyModeToMaterial(child.material, renderMode);
          }
        }
      }
    });

    if (laserRef.current) {
      laserRef.current.visible = renderMode === 'xray';
    }
  }, [renderMode]);

  const applyModeToMaterial = (mat: THREE.Material, mode: 'standard' | 'wireframe' | 'xray') => {
    const anyMat = mat as any;
    if (mode === 'wireframe') {
      anyMat.wireframe = true;
      if ('color' in anyMat) anyMat.color.set(0x0f5e63);
      anyMat.transparent = false;
    } else if (mode === 'xray') {
      anyMat.wireframe = false;
      anyMat.transparent = true;
      anyMat.opacity = 0.55;
      if ('color' in anyMat) anyMat.color.set(0x14213d);
    } else {
      anyMat.wireframe = false;
      anyMat.transparent = false;
      anyMat.opacity = 1.0;
      if ('color' in anyMat) {
        if (anyMat.name === 'accent') anyMat.color.set(0x0f5e63);
        else if (anyMat.name === 'amber') anyMat.color.set(0x9a3412);
        else if (anyMat.name === 'dark') anyMat.color.set(0x1e293b);
        else anyMat.color.set(0xe2e8f0);
      }
    }
    anyMat.needsUpdate = true;
  };

  function buildProceduralModel(
    group: THREE.Group, 
    type: ProductSpecItem['model3DType'], 
    mode: 'standard' | 'wireframe' | 'xray'
  ) {
    while (group.children.length > 0) {
      group.remove(group.children[0]);
    }

    const isWire = mode === 'wireframe';

    const metalMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      metalness: 0.85,
      roughness: 0.25,
      wireframe: isWire,
      name: 'dark'
    });

    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xf1f5f9,
      metalness: 0.3,
      roughness: 0.35,
      wireframe: isWire,
      name: 'body'
    });

    const tealAccentMat = new THREE.MeshStandardMaterial({
      color: 0x0f5e63,
      metalness: 0.5,
      roughness: 0.2,
      wireframe: isWire,
      name: 'accent'
    });

    const amberAccentMat = new THREE.MeshStandardMaterial({
      color: 0x9a3412,
      metalness: 0.4,
      roughness: 0.3,
      wireframe: isWire,
      name: 'amber'
    });

    const glowLensMat = new THREE.MeshBasicMaterial({
      color: 0x22c55e,
      wireframe: isWire
    });

    if (type === 'robot') {
      // 1. High-Tech UGV Bomb Disposal Robot
      // Chassis
      const chassisGeo = new THREE.BoxGeometry(2.2, 0.7, 1.4);
      const chassis = new THREE.Mesh(chassisGeo, metalMat);
      chassis.castShadow = true;
      group.add(chassis);

      // Top Armoured Cover
      const topCoverGeo = new THREE.BoxGeometry(1.6, 0.3, 1.1);
      const topCover = new THREE.Mesh(topCoverGeo, tealAccentMat);
      topCover.position.y = 0.5;
      topCover.castShadow = true;
      group.add(topCover);

      // Left Track
      const trackGeo = new THREE.BoxGeometry(2.5, 0.7, 0.4);
      const leftTrack = new THREE.Mesh(trackGeo, metalMat);
      leftTrack.position.set(0, -0.2, 0.85);
      leftTrack.castShadow = true;
      group.add(leftTrack);

      // Right Track
      const rightTrack = new THREE.Mesh(trackGeo, metalMat);
      rightTrack.position.set(0, -0.2, -0.85);
      rightTrack.castShadow = true;
      group.add(rightTrack);

      // Sprocket Wheels (Left and Right)
      const wheelGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.42, 16);
      [-0.9, 0, 0.9].forEach((xPos) => {
        const wL = new THREE.Mesh(wheelGeo, bodyMat);
        wL.rotation.x = Math.PI / 2;
        wL.position.set(xPos, -0.2, 0.85);
        group.add(wL);

        const wR = new THREE.Mesh(wheelGeo, bodyMat);
        wR.rotation.x = Math.PI / 2;
        wR.position.set(xPos, -0.2, -0.85);
        group.add(wR);
      });

      // Articulated Manipulator Arm Base
      const armBase = new THREE.Group();
      armBase.name = 'animatedPart';
      armBase.position.set(0.6, 0.7, 0);

      const basePivotGeo = new THREE.CylinderGeometry(0.25, 0.3, 0.3, 16);
      const basePivot = new THREE.Mesh(basePivotGeo, metalMat);
      armBase.add(basePivot);

      // Arm Segment 1
      const arm1Geo = new THREE.BoxGeometry(1.2, 0.16, 0.16);
      const arm1 = new THREE.Mesh(arm1Geo, tealAccentMat);
      arm1.position.set(0.5, 0.3, 0);
      arm1.rotation.z = Math.PI / 4;
      armBase.add(arm1);

      // Arm Segment 2 (Upper Boom)
      const arm2Geo = new THREE.BoxGeometry(1.0, 0.14, 0.14);
      const arm2 = new THREE.Mesh(arm2Geo, amberAccentMat);
      arm2.position.set(1.1, 0.8, 0);
      arm2.rotation.z = -Math.PI / 6;
      armBase.add(arm2);

      // Gripper Claw
      const clawGeo = new THREE.BoxGeometry(0.3, 0.25, 0.3);
      const claw = new THREE.Mesh(clawGeo, metalMat);
      claw.position.set(1.6, 0.65, 0);
      armBase.add(claw);

      group.add(armBase);

      // Optic Turret
      const turretGeo = new THREE.CylinderGeometry(0.18, 0.2, 0.4, 16);
      const turret = new THREE.Mesh(turretGeo, metalMat);
      turret.position.set(-0.6, 0.8, 0);
      group.add(turret);

      const opticLensGeo = new THREE.SphereGeometry(0.09, 16, 16);
      const opticLens = new THREE.Mesh(opticLensGeo, glowLensMat);
      opticLens.position.set(-0.45, 0.9, 0);
      group.add(opticLens);

      // Antenna Mast
      const antGeo = new THREE.CylinderGeometry(0.02, 0.03, 1.4, 8);
      const antenna = new THREE.Mesh(antGeo, metalMat);
      antenna.position.set(-0.8, 1.2, -0.4);
      group.add(antenna);

    } else if (type === 'scanner') {
      // 2. Full Body Scanner / DFMD Portal
      // Left Arch Column
      const colGeo = new THREE.BoxGeometry(0.4, 3.2, 0.6);
      const colLeft = new THREE.Mesh(colGeo, tealAccentMat);
      colLeft.position.set(-1.1, 0.4, 0);
      colLeft.castShadow = true;
      group.add(colLeft);

      // Right Arch Column
      const colRight = new THREE.Mesh(colGeo, tealAccentMat);
      colRight.position.set(1.1, 0.4, 0);
      colRight.castShadow = true;
      group.add(colRight);

      // Top Crossbar Console
      const topBarGeo = new THREE.BoxGeometry(2.6, 0.4, 0.7);
      const topBar = new THREE.Mesh(topBarGeo, metalMat);
      topBar.position.set(0, 2.1, 0);
      topBar.castShadow = true;
      group.add(topBar);

      // Base Footing Platform
      const baseGeo = new THREE.BoxGeometry(2.4, 0.15, 1.8);
      const basePlate = new THREE.Mesh(baseGeo, metalMat);
      basePlate.position.set(0, -1.15, 0);
      basePlate.receiveShadow = true;
      group.add(basePlate);

      // LED Scanning Zone Pillars
      const ledBarGeo = new THREE.BoxGeometry(0.08, 2.8, 0.08);
      const ledBarL = new THREE.Mesh(ledBarGeo, amberAccentMat);
      ledBarL.position.set(-0.85, 0.4, 0.28);
      group.add(ledBarL);

      const ledBarR = new THREE.Mesh(ledBarGeo, amberAccentMat);
      ledBarR.position.set(0.85, 0.4, 0.28);
      group.add(ledBarR);

      // Operator Display Screen
      const screenGeo = new THREE.BoxGeometry(0.6, 0.4, 0.05);
      const screen = new THREE.Mesh(screenGeo, glowLensMat);
      screen.position.set(1.1, 1.2, 0.35);
      group.add(screen);

    } else if (type === 'shield') {
      // 3. NIJ Level 4 Tactical Shield & Carry Rig
      // Shield Face
      const shieldGeo = new THREE.BoxGeometry(1.3, 2.2, 0.1);
      const shield = new THREE.Mesh(shieldGeo, tealAccentMat);
      shield.position.set(0, 0.3, 0);
      shield.castShadow = true;
      group.add(shield);

      // Ballistic Viewport Frame
      const vpFrameGeo = new THREE.BoxGeometry(0.6, 0.3, 0.16);
      const vpFrame = new THREE.Mesh(vpFrameGeo, metalMat);
      vpFrame.position.set(0, 1.0, 0);
      group.add(vpFrame);

      // Ballistic Glass
      const glassGeo = new THREE.BoxGeometry(0.5, 0.2, 0.18);
      const glass = new THREE.Mesh(glassGeo, glowLensMat);
      glass.position.set(0, 1.0, 0);
      group.add(glass);

      // Carry Trolley Chassis
      const trolleyPoleGeo = new THREE.CylinderGeometry(0.04, 0.04, 2.0, 12);
      const trolleyPole = new THREE.Mesh(trolleyPoleGeo, metalMat);
      trolleyPole.position.set(0, 0, -0.3);
      group.add(trolleyPole);

      // Trolley Wheel Axle
      const axleGeo = new THREE.CylinderGeometry(0.03, 0.03, 1.1, 12);
      const axle = new THREE.Mesh(axleGeo, metalMat);
      axle.rotation.z = Math.PI / 2;
      axle.position.set(0, -0.9, -0.35);
      group.add(axle);

      // Castor Wheels
      const cWheelGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.1, 16);
      const wL = new THREE.Mesh(cWheelGeo, metalMat);
      wL.rotation.z = Math.PI / 2;
      wL.position.set(-0.55, -0.9, -0.35);
      group.add(wL);

      const wR = new THREE.Mesh(cWheelGeo, metalMat);
      wR.rotation.z = Math.PI / 2;
      wR.position.set(0.55, -0.9, -0.35);
      group.add(wR);

      // Tactical Strobe Light
      const strobeGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.15, 12);
      const strobe = new THREE.Mesh(strobeGeo, amberAccentMat);
      strobe.rotation.x = Math.PI / 2;
      strobe.position.set(0, 0.5, 0.1);
      group.add(strobe);

    } else if (type === 'detector') {
      // 4. Mine / Metal Detector (DSMD / NMS30)
      // Telescopic Shaft
      const shaftGeo = new THREE.CylinderGeometry(0.04, 0.04, 2.6, 16);
      const shaft = new THREE.Mesh(shaftGeo, metalMat);
      shaft.rotation.z = -Math.PI / 6;
      shaft.position.set(0, 0.1, 0);
      group.add(shaft);

      // Search Coil (Oval Loop)
      const coilGeo = new THREE.TorusGeometry(0.55, 0.06, 16, 32);
      const coil = new THREE.Mesh(coilGeo, tealAccentMat);
      coil.position.set(0.7, -0.9, 0);
      coil.rotation.x = Math.PI / 3;
      group.add(coil);

      // Control Unit Housing
      const boxGeo = new THREE.BoxGeometry(0.45, 0.35, 0.25);
      const controlBox = new THREE.Mesh(boxGeo, tealAccentMat);
      controlBox.position.set(-0.5, 0.8, 0);
      controlBox.rotation.z = -Math.PI / 6;
      group.add(controlBox);

      // LCD Screen
      const lcdGeo = new THREE.BoxGeometry(0.25, 0.18, 0.02);
      const lcd = new THREE.Mesh(lcdGeo, glowLensMat);
      lcd.position.set(-0.5, 0.95, 0.14);
      lcd.rotation.z = -Math.PI / 6;
      group.add(lcd);

      // Arm Rest Collar
      const armrestGeo = new THREE.TorusGeometry(0.18, 0.04, 12, 16, Math.PI);
      const armrest = new THREE.Mesh(armrestGeo, amberAccentMat);
      armrest.position.set(-0.9, 1.3, 0);
      armrest.rotation.z = Math.PI / 3;
      group.add(armrest);

    } else {
      // 5. Default High-Tech Tactical Device / Serstech Raman / Sensor
      const mainGeo = new THREE.BoxGeometry(1.6, 1.0, 0.8);
      const mainBody = new THREE.Mesh(mainGeo, tealAccentMat);
      mainBody.castShadow = true;
      group.add(mainBody);

      const bumperGeo = new THREE.BoxGeometry(1.7, 0.2, 0.9);
      const bumperTop = new THREE.Mesh(bumperGeo, metalMat);
      bumperTop.position.y = 0.5;
      group.add(bumperTop);

      const bumperBottom = new THREE.Mesh(bumperGeo, metalMat);
      bumperBottom.position.y = -0.5;
      group.add(bumperBottom);

      const screenGeo = new THREE.BoxGeometry(0.8, 0.6, 0.04);
      const screen = new THREE.Mesh(screenGeo, glowLensMat);
      screen.position.set(0, 0, 0.42);
      group.add(screen);

      const lensApertureGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.4, 16);
      const lens = new THREE.Mesh(lensApertureGeo, amberAccentMat);
      lens.rotation.x = Math.PI / 2;
      lens.position.set(0, 0, -0.5);
      group.add(lens);
    }
  }

  const handleZoom = (direction: 'in' | 'out') => {
    if (!cameraRef.current) return;
    const delta = direction === 'in' ? -5 : 5;
    const newFov = Math.max(25, Math.min(60, cameraRef.current.fov + delta));
    cameraRef.current.fov = newFov;
    cameraRef.current.updateProjectionMatrix();
    setZoomLevel(Number(((40 / newFov)).toFixed(1)));
  };

  const resetView = () => {
    if (!modelGroupRef.current || !cameraRef.current) return;
    modelGroupRef.current.rotation.set(0, 0, 0);
    cameraRef.current.fov = 40;
    cameraRef.current.updateProjectionMatrix();
    setZoomLevel(1);
  };

  return (
    <div className={`relative rounded-[16px] overflow-hidden bg-gradient-to-b from-[#FAF9F6] to-[#ECEAE3] border border-[#DCD8CE] shadow-sm select-none ${className}`}>
      {/* 3D Canvas Mount Point */}
      <div 
        ref={mountRef} 
        className="w-full h-full min-h-[380px] lg:min-h-[440px] cursor-grab active:cursor-grabbing"
      />

      {/* Top Floating Telemetry & Inspection Bar */}
      <div className="absolute top-4 left-4 right-4 flex items-center justify-between pointer-events-none">
        <div className="flex items-center gap-2 pointer-events-auto">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/90 backdrop-blur-md border border-[#DCD8CE] shadow-sm text-xs font-mono font-medium text-[#14213D]">
            <Radio className="w-3.5 h-3.5 text-[#0F5E63] animate-pulse" />
            <span>3D TACTICAL VIEWPORT</span>
            <span className="text-[#9A3412] font-semibold">[{product.code}]</span>
          </div>

          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/90 backdrop-blur-md border border-[#DCD8CE] shadow-sm text-[11px] font-mono text-[#4A5568]">
            <Activity className="w-3.5 h-3.5 text-emerald-600" />
            <span>PBR REALTIME: 60 FPS</span>
          </div>
        </div>

        {/* Viewport Mode Controls */}
        <div className="flex items-center gap-1.5 pointer-events-auto bg-white/90 backdrop-blur-md border border-[#DCD8CE] p-1 rounded-xl shadow-sm">
          <button
            onClick={() => setRenderMode('standard')}
            className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-all ${
              renderMode === 'standard'
                ? 'bg-[#0F5E63] text-white shadow-sm'
                : 'text-[#4A5568] hover:text-[#14213D] hover:bg-[#F6F5F1]'
            }`}
          >
            Realistic
          </button>
          <button
            onClick={() => setRenderMode('wireframe')}
            className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-all ${
              renderMode === 'wireframe'
                ? 'bg-[#0F5E63] text-white shadow-sm'
                : 'text-[#4A5568] hover:text-[#14213D] hover:bg-[#F6F5F1]'
            }`}
          >
            CAD Mesh
          </button>
          <button
            onClick={() => setRenderMode('xray')}
            className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-all ${
              renderMode === 'xray'
                ? 'bg-[#9A3412] text-white shadow-sm'
                : 'text-[#4A5568] hover:text-[#14213D] hover:bg-[#F6F5F1]'
            }`}
          >
            X-Ray Scan
          </button>
        </div>
      </div>

      {/* Bottom Floating Hotspot & Spec Overlays */}
      <div className="absolute bottom-4 left-4 right-4 flex flex-col sm:flex-row items-end sm:items-center justify-between gap-3 pointer-events-none">
        {/* Product Brand Badges */}
        <div className="pointer-events-auto flex flex-wrap items-center gap-2">
          <div className="px-3 py-1.5 rounded-lg bg-[#14213D]/90 backdrop-blur-md text-white border border-[#14213D] shadow-sm text-xs font-serif font-semibold">
            {product.make}
          </div>
          <div className="px-2.5 py-1.5 rounded-lg bg-white/90 backdrop-blur-md text-[#0F5E63] border border-[#0F5E63]/30 shadow-sm text-xs font-mono font-medium">
            {product.specRef}
          </div>
          {product.isMhaQr && (
            <div className="px-2.5 py-1.5 rounded-lg bg-[#FBEBDD] text-[#9A3412] border border-[#9A3412]/30 shadow-sm text-xs font-medium flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>MHA QR Certified</span>
            </div>
          )}
        </div>

        {/* View Controls Toolbar */}
        <div className="pointer-events-auto flex items-center gap-1.5 bg-white/90 backdrop-blur-md border border-[#DCD8CE] p-1 rounded-xl shadow-sm">
          <button
            onClick={() => setIsRotating(!isRotating)}
            title={isRotating ? 'Pause Orbit' : 'Resume Orbit'}
            className={`p-1.5 rounded-lg transition-colors ${
              isRotating ? 'bg-[#E3EFEE] text-[#0F5E63]' : 'text-[#4A5568] hover:bg-[#F6F5F1]'
            }`}
          >
            <RotateCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => handleZoom('in')}
            title="Zoom In"
            className="p-1.5 rounded-lg text-[#4A5568] hover:text-[#14213D] hover:bg-[#F6F5F1]"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            onClick={() => handleZoom('out')}
            title="Zoom Out"
            className="p-1.5 rounded-lg text-[#4A5568] hover:text-[#14213D] hover:bg-[#F6F5F1]"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <button
            onClick={resetView}
            title="Reset Perspective"
            className="p-1.5 rounded-lg text-[#4A5568] hover:text-[#14213D] hover:bg-[#F6F5F1]"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
