import React, { useRef, useEffect, useState, useCallback } from 'react';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { OrbitControls } from 'three-stdlib';
import { Text } from 'troika-three-text';

const BallAnimation = () => {
  const canvasRef = useRef(null);
  const [numBalls, setNumBalls] = useState(5);
  const [gravity, setGravity] = useState(-9.82);
  const [ballColors, setBallColors] = useState(['#ff0000']);
  const [ballSize, setBallSize] = useState(0.5);
  const [isPaused, setIsPaused] = useState(false);
  const [boxSize, setBoxSize] = useState(20);
  const balls = useRef([]);
  const trails = useRef([]);
  const ballInfoTexts = useRef([]);

  const world = useRef(new CANNON.World()).current;
  const scene = useRef(new THREE.Scene()).current;
  const camera = useRef(new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000)).current;
  const renderer = useRef(null);

  // Referências para o áudio
  const audioContext = useRef(null);
  const analyser = useRef(null);
  const dataArray = useRef(null);
  const source = useRef(null); // Adicionado para armazenar a fonte de áudio

  // Referência para a função animate
  const animateRef = useRef();

  // Função para obter a amplitude do áudio
  const getAudioAmplitude = useCallback(() => {
    if (!analyser.current) return 0;

    analyser.current.getByteFrequencyData(dataArray.current);
    let sum = 0;
    for (const amplitude of dataArray.current) {
      sum += amplitude;
    }
    return sum / dataArray.current.length;
  }, []);

  const getSpeedColor = useCallback((speed) => {
    const maxSpeed = 15;
    const normalizedSpeed = Math.min(speed / maxSpeed, 1);

    const color = new THREE.Color();
    color.setHSL(0.7 * (1 - normalizedSpeed), 1, 0.5);

    return `#${color.getHexString()}`;
  }, []);

  // --- Função para Criar Bolas ---
  const createBall = useCallback((color, size) => {
    const sphereGeometry = new THREE.SphereGeometry(size, 32, 32);
    const sphereMaterial = new THREE.MeshPhongMaterial({ color });
    const sphereMesh = new THREE.Mesh(sphereGeometry, sphereMaterial);
    sphereMesh.castShadow = true;
    sphereMesh.receiveShadow = true;
    scene.add(sphereMesh);

    const sphereShape = new CANNON.Sphere(size);
    const sphereBody = new CANNON.Body({
      mass: 1,
      shape: sphereShape,
      restitution: 0.7,
    });
    sphereBody.position.set((Math.random() - 0.5) * 5, 5, (Math.random() - 0.5) * 5);
    world.addBody(sphereBody);

    const infoText = new Text();
    infoText.fontSize = 0.5;
    infoText.color = 0xffffff;
    infoText.anchorX = 'center';
    infoText.anchorY = 'bottom';
    scene.add(infoText);
    ballInfoTexts.current.push(infoText);

    const trailGeometry = new THREE.BufferGeometry();
    const numTrailPoints = 50;
    const positions = new Float32Array(numTrailPoints * 3);
    trailGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const trailMaterial = new THREE.LineBasicMaterial({ color: color, linewidth: 2 });
    const trail = new THREE.Line(trailGeometry, trailMaterial);
    trails.current.push(trail);
    scene.add(trail);

    balls.current.push({ mesh: sphereMesh, body: sphereBody, trail: trail, infoText: infoText });
  }, [scene, world]);

  // --- Função para Reiniciar as Bolas ---
  const resetBalls = useCallback(() => {
    balls.current.forEach(({ mesh, body, trail, infoText }) => {
      scene.remove(mesh);
      world.removeBody(body);
      scene.remove(trail);
      scene.remove(infoText);
    });
    balls.current = [];
    trails.current = [];
    ballInfoTexts.current = [];
  }, [scene, world]);

  // --- Função para Criar as Paredes da Caixa ---
  const createWalls = useCallback(() => {
    const wallMaterial = new CANNON.Material();
    const wallThickness = 0.5;
    const wallHeight = boxSize;
    const wallGeometry = new THREE.BoxGeometry(boxSize, wallHeight, wallThickness);

    const threeWallMaterial = new THREE.MeshPhongMaterial({
      color: 0x666666,
      side: THREE.DoubleSide,
    });
    const threeCeilingMaterial = new THREE.MeshPhongMaterial({
      color: 0x666666,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.2,
    });

    const createWall = (position, quaternion, material) => {
      const wallShape = new CANNON.Box(new CANNON.Vec3(boxSize / 2, wallHeight / 2, wallThickness / 2));
      const wallBody = new CANNON.Body({
        mass: 0,
        shape: wallShape,
        material: wallMaterial,
      });
      wallBody.position.copy(position);
      wallBody.quaternion.copy(quaternion);
      world.addBody(wallBody);

      const wallMesh = new THREE.Mesh(wallGeometry, material);
      wallMesh.position.copy(position);
      wallMesh.quaternion.copy(quaternion);
      scene.add(wallMesh);
    };

    // Chão, Teto e Paredes
    createWall(new CANNON.Vec3(0, -wallHeight / 2, 0), new CANNON.Quaternion().setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2), threeWallMaterial);
    createWall(new CANNON.Vec3(0, wallHeight / 2, 0), new CANNON.Quaternion().setFromAxisAngle(new CANNON.Vec3(1, 0, 0), Math.PI / 2), threeCeilingMaterial);
    createWall(new CANNON.Vec3(0, 0, -boxSize / 2), new CANNON.Quaternion().setFromAxisAngle(new CANNON.Vec3(0, 0, 0), 0), threeWallMaterial);
    createWall(new CANNON.Vec3(0, 0, boxSize / 2), new CANNON.Quaternion().setFromAxisAngle(new CANNON.Vec3(1, 0, 0), Math.PI), threeWallMaterial);
    createWall(new CANNON.Vec3(-boxSize / 2, 0, 0), new CANNON.Quaternion().setFromAxisAngle(new CANNON.Vec3(0, 1, 0), Math.PI / 2), threeWallMaterial);
    createWall(new CANNON.Vec3(boxSize / 2, 0, 0), new CANNON.Quaternion().setFromAxisAngle(new CANNON.Vec3(0, 1, 0), -Math.PI / 2), threeWallMaterial);
  }, [boxSize, scene, world]);

  // --- Efeito para Configuração Inicial, Animação e Limpeza ---
  useEffect(() => {
    renderer.current = new THREE.WebGLRenderer({ canvas: canvasRef.current, antialias: true });
    renderer.current.setSize(window.innerWidth, window.innerHeight);
    renderer.current.setClearColor(0x000000);
    renderer.current.shadowMap.enabled = true;

    world.gravity.set(0, gravity, 0);
    world.broadphase = new CANNON.NaiveBroadphase();
    world.solver.iterations = 10;

    const ambientLight = new THREE.AmbientLight(0x404040);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
    directionalLight.position.set(5, 5, 5);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 1024;
    directionalLight.shadow.mapSize.height = 1024;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 500;
    scene.add(directionalLight);

    // Plano (Chão)
    const planeGeometry = new THREE.PlaneGeometry(boxSize, boxSize);
    const planeMaterial = new THREE.MeshPhongMaterial({ color: 0x999999, side: THREE.DoubleSide });
    const planeMesh = new THREE.Mesh(planeGeometry, planeMaterial);
    planeMesh.rotation.x = -Math.PI / 2;
    planeMesh.receiveShadow = true;
    scene.add(planeMesh);

    const planeShape = new CANNON.Plane();
    const planeBody = new CANNON.Body({ mass: 0, shape: planeShape });
    planeBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
    world.addBody(planeBody);

    // Paredes e Teto
    createWalls();

    // Contato entre Bola e Parede
    const ballMaterial = new CANNON.Material();
    const wallMaterial = new CANNON.Material();
    world.addContactMaterial(new CANNON.ContactMaterial(ballMaterial, wallMaterial, {
      friction: 0.1,
      restitution: 0.7
    }));

    balls.current.forEach(({ body }) => {
      body.material = ballMaterial;
    });

    // Câmera e Controles
    camera.position.set(0, 8, 25);
    camera.lookAt(0, 0, 0);

    const controls = new OrbitControls(camera, renderer.current.domElement);
    controls.target.set(0, 0, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    // Função de Animação
    animateRef.current = () => {
        if (isPaused) return;
        requestAnimationFrame(animateRef.current);
        world.gravity.set(0, gravity, 0);
        world.step(1 / 60);
      
        // Usa a amplitude do áudio para o efeito de pulo
        const amplitude = getAudioAmplitude();
      
        balls.current.forEach(({ mesh, body, trail, infoText }) => {
          // Reatividade ao som (PULO)
          if (amplitude > 30) {
            let impulse = new CANNON.Vec3(0, amplitude * 0.1, 0);
            body.applyImpulse(impulse, body.position);
          }
      
          // Atualiza a posição da malha
          mesh.position.copy(body.position);
          mesh.quaternion.copy(body.quaternion);
      
          // Atualiza a cor da bola com base na velocidade
          const speed = body.velocity.length();
          const newColor = getSpeedColor(speed);
          mesh.material.color.set(newColor);
      
          // Atualiza o rastro
          let positions = trail.geometry.attributes.position.array;
          if (positions.length < 3 * 50) {
            positions = new Float32Array(3 * 50);
          }
          positions = [...positions.slice(3), body.position.x, body.position.y, body.position.z];
          trail.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
          trail.geometry.attributes.position.needsUpdate = true;
      
          // Atualiza a informação de texto
          infoText.text = `Vel: ${speed.toFixed(2)}`;
          infoText.position.set(body.position.x, body.position.y + ballSize, body.position.z);
          infoText.sync();
        });
      
        controls.update();
        renderer.current.render(scene, camera);
      };

    // Iniciar a animação
    animateRef.current();

    // Redimensionamento
    const handleResize = () => {
      renderer.current.setSize(window.innerWidth, window.innerHeight);
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', handleResize);

    // Limpeza
    return () => {
      window.removeEventListener('resize', handleResize);
      controls.dispose();
      renderer.current.dispose();
      renderer.current = null;
    };
}, [gravity, scene, camera, world, ballColors, boxSize, getAudioAmplitude, createWalls, ballSize, getSpeedColor, isPaused]);

  useEffect(() => {
    resetBalls();
    for (let i = 0; i < numBalls; i++) {
      const colorIndex = i % ballColors.length;
      createBall(ballColors[colorIndex], ballSize);
    }
  }, [resetBalls, createBall, numBalls, ballColors, ballSize]);

  // --- Manipuladores de Eventos para os Controles ---
  const handleAddBall = () => {
    const colorIndex = balls.current.length % ballColors.length;
    createBall(ballColors[colorIndex], ballSize);
    setNumBalls(numBalls + 1);
  };

  const handleColorChange = (newColors) => {
    setBallColors(newColors);
    resetBalls();
    for (let i = 0; i < numBalls; i++) {
      const colorIndex = i % newColors.length;
      createBall(newColors[colorIndex], ballSize);
    }
  };

  const handleSizeChange = (newSize) => {
    setBallSize(newSize);
    resetBalls();
    for (let i = 0; i < numBalls; i++) {
      const colorIndex = i % ballColors.length;
      createBall(ballColors[colorIndex], newSize);
    }
  };

  const handleTogglePause = () => {
    setIsPaused(!isPaused);
    if (!isPaused) {
        // Chamar a função de animação através da referência
        animateRef.current();
      }
  };

  const handleReset = () => {
    resetBalls();
    for (let i = 0; i < numBalls; i++) {
      const colorIndex = i % ballColors.length;
      createBall(ballColors[colorIndex], ballSize);
    }
    setIsPaused(false);
  };

  // --- Atualiza o tamanho da caixa quando boxSize muda ---
  const handleBoxSizeChange = useCallback((newSize) => {
    setBoxSize(newSize);
    resetBalls();

    // Remove as paredes antigas
    scene.children.forEach(child => {
      if (child.geometry instanceof THREE.BoxGeometry) {
        scene.remove(child);
      }
    });
    world.bodies.forEach(body => {
      if (body.shapes[0] instanceof CANNON.Box) {
        world.removeBody(body);
      }
    });

    // Recria as paredes com o novo tamanho
    createWalls();

    // Recria as bolas
    for (let i = 0; i < numBalls; i++) {
      const colorIndex = i % ballColors.length;
      createBall(ballColors[colorIndex], ballSize);
    }
  }, [setBoxSize, resetBalls, createWalls, createBall, numBalls, ballColors, ballSize, scene, world]);

  // --- Lidar com o upload de áudio ---
  const handleAudioUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      audioContext.current = new AudioContext();
      audioContext.current.decodeAudioData(e.target.result, (buffer) => {
        if (source.current) {
          source.current.disconnect();
        }

        source.current = audioContext.current.createBufferSource();
        source.current.buffer = buffer;
        analyser.current = audioContext.current.createAnalyser();
        source.current.connect(analyser.current);
        analyser.current.connect(audioContext.current.destination);
        source.current.start(0);
        analyser.current.fftSize = 256;
        dataArray.current = new Uint8Array(analyser.current.frequencyBinCount);
      });
    };
    reader.readAsArrayBuffer(file);
  };

  // --- JSX para os Controles e Renderização ---
  return (
    <div className="animation-container">
      <div className="controls-panel">
        <div className="control-group">
          <button onClick={handleAddBall}>Gerar Bola</button>
          <button onClick={handleTogglePause}>{isPaused ? "Retomar" : "Pausar"}</button>
          <button onClick={handleReset}>Reiniciar</button>
        </div>
        <div className="control-group">
          <label htmlFor="numBalls">Número de Bolas: {numBalls}</label>
          <input
            type="range"
            id="numBalls"
            min="1"
            max="50"
            value={numBalls}
            onChange={(e) => setNumBalls(parseInt(e.target.value))}
            disabled={true}
          />
        </div>
        <div className="control-group">
          <label htmlFor="gravity">Gravidade: {gravity}</label>
          <input
            type="range"
            id="gravity"
            min="-20"
            max="0"
            step="0.1"
            value={gravity}
            onChange={(e) => setGravity(parseFloat(e.target.value))}
          />
        </div>
        <div className="control-group">
          <label htmlFor="ballSize">Tamanho das Bolas: {ballSize}</label>
          <input
            type="range"
            id="ballSize"
            min="0.1"
            max="2"
            step="0.1"
            value={ballSize}
            onChange={(e) => handleSizeChange(parseFloat(e.target.value))}
          />
        </div>
        <div className="control-group">
          <label htmlFor="boxSize">Tamanho da Caixa: {boxSize}</label>
          <input
            type="range"
            id="boxSize"
            min="5"
            max="50"
            step="1"
            value={boxSize}
            onChange={(e) => handleBoxSizeChange(parseFloat(e.target.value))}
          />
        </div>
        <div className="control-group colors-control">
          <button className="color-button" onClick={() => handleColorChange(['#ff0000', '#00ff00', '#0000ff'])}>
            Cores 1
          </button>
          <button className="color-button" onClick={() => handleColorChange(['#ffff00', '#ff00ff', '#00ffff'])}>
            Cores 2
          </button>
          <button className="color-button" onClick={() => handleColorChange(['#FFA500', '#800080', '#008080', '#000080'])}>
            Cores 3
          </button>
        </div>
        <div className="control-group">
          <input type="file" accept="audio/*" onChange={handleAudioUpload} />
        </div>
      </div>
      <canvas ref={canvasRef} />
    </div>
  );
};

export default BallAnimation;