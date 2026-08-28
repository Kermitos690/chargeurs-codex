import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type ChargeursSceneCue =
  | "BOOT"
  | "HOME_IDLE"
  | "SLOT_FOCUS"
  | "PAYMENT_READY"
  | "TERMINAL_PROCESSING"
  | "QR_PROCESSING"
  | "PAYMENT_CONFIRMED"
  | "RELEASE_WAIT"
  | "RELEASE_CONFIRMED"
  | "ACTIVE"
  | "RETURN_GUIDANCE"
  | "RETURN_ACCEPTED"
  | "RECOVERY"
  | "ERROR"
  | "OFFLINE";

export type ChargeursRenderTier = "HIGH" | "MEDIUM" | "SAFE";

type Props = {
  sceneCue: ChargeursSceneCue;
  renderTier: ChargeursRenderTier;
  reducedMotion?: boolean;
  slotNumber?: number | null;
  className?: string;
};

type SceneVisual = {
  accent: [number, number, number];
  powerbankY: number;
  powerbankTilt: number;
  energy: number;
  pulse: number;
  label: string;
};

const CUE_VISUALS: Record<ChargeursSceneCue, SceneVisual> = {
  BOOT: { accent: [0.12, 0.62, 0.95], powerbankY: 0.86, powerbankTilt: -0.10, energy: 0.25, pulse: 0.25, label: "INITIALISATION" },
  HOME_IDLE: { accent: [0.12, 0.82, 0.82], powerbankY: 0.82, powerbankTilt: -0.08, energy: 0.40, pulse: 0.35, label: "PRÊT" },
  SLOT_FOCUS: { accent: [0.10, 0.88, 0.72], powerbankY: 0.64, powerbankTilt: -0.05, energy: 0.65, pulse: 0.65, label: "BATTERIE SÉLECTIONNÉE" },
  PAYMENT_READY: { accent: [0.14, 0.74, 0.95], powerbankY: 0.68, powerbankTilt: -0.03, energy: 0.55, pulse: 0.55, label: "PAIEMENT PRÊT" },
  TERMINAL_PROCESSING: { accent: [0.22, 0.55, 1.00], powerbankY: 0.68, powerbankTilt: 0, energy: 0.76, pulse: 0.90, label: "TERMINAL EN COURS" },
  QR_PROCESSING: { accent: [0.18, 0.78, 0.96], powerbankY: 0.68, powerbankTilt: 0, energy: 0.72, pulse: 0.78, label: "QR EN COURS" },
  PAYMENT_CONFIRMED: { accent: [0.10, 0.90, 0.55], powerbankY: 0.61, powerbankTilt: 0.02, energy: 0.95, pulse: 1.00, label: "PAIEMENT CONFIRMÉ" },
  RELEASE_WAIT: { accent: [0.12, 0.82, 0.84], powerbankY: 0.56, powerbankTilt: 0, energy: 0.78, pulse: 0.85, label: "LIBÉRATION EN ATTENTE" },
  RELEASE_CONFIRMED: { accent: [0.12, 0.92, 0.58], powerbankY: 0.28, powerbankTilt: 0.13, energy: 1.00, pulse: 1.00, label: "BATTERIE LIBÉRÉE" },
  ACTIVE: { accent: [0.15, 0.86, 0.58], powerbankY: 0.18, powerbankTilt: 0.16, energy: 0.82, pulse: 0.55, label: "LOCATION ACTIVE" },
  RETURN_GUIDANCE: { accent: [0.12, 0.76, 0.95], powerbankY: 0.28, powerbankTilt: -0.12, energy: 0.62, pulse: 0.76, label: "INSÉREZ LA BATTERIE" },
  RETURN_ACCEPTED: { accent: [0.10, 0.92, 0.54], powerbankY: 0.71, powerbankTilt: 0, energy: 1.00, pulse: 1.00, label: "RETOUR ACCEPTÉ" },
  RECOVERY: { accent: [0.96, 0.62, 0.12], powerbankY: 0.62, powerbankTilt: 0, energy: 0.34, pulse: 0.45, label: "VÉRIFICATION" },
  ERROR: { accent: [0.96, 0.22, 0.22], powerbankY: 0.62, powerbankTilt: 0, energy: 0.18, pulse: 0.25, label: "INTERVENTION REQUISE" },
  OFFLINE: { accent: [0.46, 0.54, 0.64], powerbankY: 0.67, powerbankTilt: 0, energy: 0.12, pulse: 0.10, label: "HORS LIGNE" },
};

const VERTEX_SHADER = `
attribute vec3 aPosition;
uniform vec3 uTranslate;
uniform vec3 uScale;
uniform float uRotateY;
uniform float uRotateZ;
uniform float uAspect;

void main() {
  vec3 p = aPosition * uScale;

  float cz = cos(uRotateZ);
  float sz = sin(uRotateZ);
  p.xy = mat2(cz, -sz, sz, cz) * p.xy;

  float cy = cos(uRotateY);
  float sy = sin(uRotateY);
  p.xz = mat2(cy, sy, -sy, cy) * p.xz;

  p += uTranslate;

  float depth = max(1.2, -p.z);
  vec2 projected = vec2(p.x / uAspect, p.y) * (2.75 / depth);
  float clipDepth = clamp((-p.z - 2.0) / 7.0, 0.0, 1.0) * 2.0 - 1.0;
  gl_Position = vec4(projected, clipDepth, 1.0);
}
`;

const FRAGMENT_SHADER = `
precision mediump float;
uniform vec3 uColor;
uniform float uEnergy;
uniform float uPulse;

void main() {
  float intensity = 0.78 + (uEnergy * 0.18) + (uPulse * 0.04);
  gl_FragColor = vec4(uColor * intensity, 1.0);
}
`;

const CUBE_VERTICES = new Float32Array([
  -1,-1, 1,  1,-1, 1,  1, 1, 1, -1,-1, 1,  1, 1, 1, -1, 1, 1,
  -1,-1,-1, -1, 1,-1,  1, 1,-1, -1,-1,-1,  1, 1,-1,  1,-1,-1,
  -1, 1,-1, -1, 1, 1,  1, 1, 1, -1, 1,-1,  1, 1, 1,  1, 1,-1,
  -1,-1,-1,  1,-1,-1,  1,-1, 1, -1,-1,-1,  1,-1, 1, -1,-1, 1,
   1,-1,-1,  1, 1,-1,  1, 1, 1,  1,-1,-1,  1, 1, 1,  1,-1, 1,
  -1,-1,-1, -1,-1, 1, -1, 1, 1, -1,-1,-1, -1, 1, 1, -1, 1,-1,
]);

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("WEBGL_SHADER_CREATE_FAILED");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || "WEBGL_SHADER_COMPILE_FAILED";
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

type WebGlSceneProps = Pick<Props, "sceneCue" | "reducedMotion"> & { onFailure: () => void };

function WebGlScene({ sceneCue, reducedMotion = false, onFailure }: WebGlSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const visual = CUE_VISUALS[sceneCue];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: true,
      depth: true,
      powerPreference: "high-performance",
      preserveDrawingBuffer: false,
    });

    if (!gl) {
      onFailure();
      return;
    }

    let raf = 0;
    let program: WebGLProgram | null = null;
    let buffer: WebGLBuffer | null = null;
    let vertexShader: WebGLShader | null = null;
    let fragmentShader: WebGLShader | null = null;

    try {
      vertexShader = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
      fragmentShader = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
      program = gl.createProgram();
      if (!program) throw new Error("WEBGL_PROGRAM_CREATE_FAILED");
      gl.attachShader(program, vertexShader);
      gl.attachShader(program, fragmentShader);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program) || "WEBGL_LINK_FAILED");
      }
      gl.useProgram(program);

      buffer = gl.createBuffer();
      if (!buffer) throw new Error("WEBGL_BUFFER_CREATE_FAILED");
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, CUBE_VERTICES, gl.STATIC_DRAW);

      const position = gl.getAttribLocation(program, "aPosition");
      const translateLoc = gl.getUniformLocation(program, "uTranslate");
      const scaleLoc = gl.getUniformLocation(program, "uScale");
      const rotateYLoc = gl.getUniformLocation(program, "uRotateY");
      const rotateZLoc = gl.getUniformLocation(program, "uRotateZ");
      const aspectLoc = gl.getUniformLocation(program, "uAspect");
      const colorLoc = gl.getUniformLocation(program, "uColor");
      const energyLoc = gl.getUniformLocation(program, "uEnergy");
      const pulseLoc = gl.getUniformLocation(program, "uPulse");

      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 0, 0);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);

      const drawBox = (
        translate: [number, number, number],
        scale: [number, number, number],
        color: [number, number, number],
        rotateY: number,
        rotateZ: number,
        energy: number,
        pulse: number,
        aspect: number,
      ) => {
        gl.uniform3fv(translateLoc, new Float32Array(translate));
        gl.uniform3fv(scaleLoc, new Float32Array(scale));
        gl.uniform1f(rotateYLoc, rotateY);
        gl.uniform1f(rotateZLoc, rotateZ);
        gl.uniform1f(aspectLoc, aspect);
        gl.uniform3fv(colorLoc, new Float32Array(color));
        gl.uniform1f(energyLoc, energy);
        gl.uniform1f(pulseLoc, pulse);
        gl.drawArrays(gl.TRIANGLES, 0, CUBE_VERTICES.length / 3);
      };

      const render = (time: number) => {
        const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        const width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
        const height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }

        gl.viewport(0, 0, width, height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        const aspect = width / height;
        const seconds = reducedMotion ? 0 : time * 0.001;
        const wave = reducedMotion ? 0 : Math.sin(seconds * 2.1) * 0.035 * visual.pulse;
        const accent = visual.accent;
        const powerbankColor: [number, number, number] = [
          Math.min(1, 0.74 + accent[0] * 0.12),
          Math.min(1, 0.78 + accent[1] * 0.10),
          Math.min(1, 0.84 + accent[2] * 0.08),
        ];

        drawBox([0, -0.90, -4.8], [1.60, 0.56, 0.96], [0.08, 0.11, 0.17], -0.22, 0, 0.20, 0, aspect);
        drawBox([0, -0.38, -4.25], [0.94, 0.15, 0.64], accent, -0.22, 0, visual.energy * 0.55, visual.pulse * 0.20, aspect);
        drawBox([0, visual.powerbankY - 0.52 + wave, -3.78], [0.42, 0.98, 0.20], powerbankColor, -0.18, visual.powerbankTilt, visual.energy, visual.pulse, aspect);
        drawBox([0, 0.66 + wave * 0.20, -4.05], [1.14, 0.022, 0.022], accent, 0, 0, visual.energy, visual.pulse, aspect);

        if (!reducedMotion) raf = window.requestAnimationFrame(render);
      };

      render(0);
    } catch (error) {
      console.warn("ChargeursEnergyScene: HIGH tier failed, falling back to MEDIUM", error);
      onFailure();
    }

    return () => {
      window.cancelAnimationFrame(raf);
      if (buffer) gl.deleteBuffer(buffer);
      if (program) gl.deleteProgram(program);
      if (vertexShader) gl.deleteShader(vertexShader);
      if (fragmentShader) gl.deleteShader(fragmentShader);
    };
  }, [onFailure, reducedMotion, sceneCue, visual]);

  return <canvas ref={canvasRef} className="h-full w-full" aria-hidden="true" data-chargeurs-webgl="energy-scene-v1" />;
}

function FallbackScene({ sceneCue, safe }: { sceneCue: ChargeursSceneCue; safe: boolean }) {
  const visual = CUE_VISUALS[sceneCue];
  const accent = `rgb(${Math.round(visual.accent[0] * 255)} ${Math.round(visual.accent[1] * 255)} ${Math.round(visual.accent[2] * 255)})`;

  return (
    <div className="relative h-full w-full overflow-hidden" aria-hidden="true" data-chargeurs-fallback={safe ? "safe" : "medium"}>
      <div className="absolute inset-x-[16%] bottom-[8%] h-[42%] rounded-[2rem] border border-white/10 bg-slate-950/90 shadow-2xl" />
      <div className="absolute inset-x-[28%] bottom-[31%] h-[8%] rounded-full blur-xl" style={{ background: accent, opacity: 0.22 }} />
      <div
        className="absolute left-1/2 h-[45%] w-[22%] rounded-[1.4rem] border border-white/50 bg-gradient-to-br from-slate-100 via-slate-400 to-slate-200 shadow-xl"
        style={{
          bottom: `${18 + visual.powerbankY * 30}%`,
          transform: `translateX(-50%) rotate(${visual.powerbankTilt * 28}deg)`,
          transition: safe ? "none" : "bottom 420ms ease, transform 420ms ease",
        }}
      />
      <div className="absolute inset-x-[22%] bottom-[27%] h-[2px]" style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)`, boxShadow: `0 0 18px ${accent}` }} />
    </div>
  );
}

export function ChargeursEnergyScene({ sceneCue, renderTier, reducedMotion = false, slotNumber, className = "" }: Props) {
  const visual = useMemo(() => CUE_VISUALS[sceneCue], [sceneCue]);
  const [webglFailed, setWebglFailed] = useState(false);
  const markWebglFailed = useCallback(() => setWebglFailed(true), []);
  const effectiveTier: ChargeursRenderTier = webglFailed && renderTier === "HIGH" ? "MEDIUM" : renderTier;
  const accent = `rgb(${Math.round(visual.accent[0] * 255)} ${Math.round(visual.accent[1] * 255)} ${Math.round(visual.accent[2] * 255)})`;

  useEffect(() => {
    if (renderTier !== "HIGH") setWebglFailed(false);
  }, [renderTier]);

  return (
    <section
      className={`relative isolate overflow-hidden rounded-[2rem] border border-white/10 bg-slate-950/80 ${className}`}
      aria-label={`${visual.label}${slotNumber ? ` — slot ${slotNumber}` : ""}`}
      data-scene-cue={sceneCue}
      data-render-tier={effectiveTier}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_18%,rgba(255,255,255,.08),transparent_36%)]" aria-hidden="true" />
      <div className="absolute inset-0">
        {effectiveTier === "HIGH" ? (
          <WebGlScene sceneCue={sceneCue} reducedMotion={reducedMotion} onFailure={markWebglFailed} />
        ) : (
          <FallbackScene sceneCue={sceneCue} safe={effectiveTier === "SAFE" || reducedMotion} />
        )}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-black/75 via-black/30 to-transparent px-5 pb-4 pt-16">
        <div>
          <div className="text-[10px] font-black tracking-[0.26em]" style={{ color: accent }}>CHARGEURS ENERGY</div>
          <div className="mt-1 text-sm font-bold text-white/80">{visual.label}</div>
        </div>
        <div className="rounded-full border border-white/10 bg-black/35 px-3 py-2 text-[10px] font-black tracking-[0.14em] text-white/55">
          {slotNumber ? `SLOT ${slotNumber}` : effectiveTier}
        </div>
      </div>
    </section>
  );
}
