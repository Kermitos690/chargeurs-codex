import { useEffect, useMemo, useRef, useState } from "react";

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
  BOOT: { accent: [0.12, 0.62, 0.95], powerbankY: 0.86, powerbankTilt: -0.1, energy: 0.25, pulse: 0.25, label: "INITIALISATION" },
  HOME_IDLE: { accent: [0.12, 0.82, 0.82], powerbankY: 0.82, powerbankTilt: -0.08, energy: 0.4, pulse: 0.35, label: "PRÊT" },
  SLOT_FOCUS: { accent: [0.10, 0.88, 0.72], powerbankY: 0.64, powerbankTilt: -0.05, energy: 0.65, pulse: 0.65, label: "BATTERIE SÉLECTIONNÉE" },
  PAYMENT_READY: { accent: [0.14, 0.74, 0.95], powerbankY: 0.68, powerbankTilt: -0.03, energy: 0.55, pulse: 0.55, label: "PAIEMENT PRÊT" },
  TERMINAL_PROCESSING: { accent: [0.22, 0.55, 1.0], powerbankY: 0.68, powerbankTilt: 0, energy: 0.76, pulse: 0.9, label: "TERMINAL EN COURS" },
  QR_PROCESSING: { accent: [0.18, 0.78, 0.96], powerbankY: 0.68, powerbankTilt: 0, energy: 0.72, pulse: 0.78, label: "QR EN COURS" },
  PAYMENT_CONFIRMED: { accent: [0.10, 0.90, 0.55], powerbankY: 0.61, powerbankTilt: 0.02, energy: 0.95, pulse: 1, label: "PAIEMENT CONFIRMÉ" },
  RELEASE_WAIT: { accent: [0.12, 0.82, 0.84], powerbankY: 0.56, powerbankTilt: 0, energy: 0.78, pulse: 0.85, label: "LIBÉRATION EN ATTENTE" },
  RELEASE_CONFIRMED: { accent: [0.12, 0.92, 0.58], powerbankY: 0.28, powerbankTilt: 0.13, energy: 1, pulse: 1, label: "BATTERIE LIBÉRÉE" },
  ACTIVE: { accent: [0.15, 0.86, 0.58], powerbankY: 0.18, powerbankTilt: 0.16, energy: 0.82, pulse: 0.55, label: "LOCATION ACTIVE" },
  RETURN_GUIDANCE: { accent: [0.12, 0.76, 0.95], powerbankY: 0.28, powerbankTilt: -0.12, energy: 0.62, pulse: 0.76, label: "INSÉREZ LA BATTERIE" },
  RETURN_ACCEPTED: { accent: [0.10, 0.92, 0.54], powerbankY: 0.71, powerbankTilt: 0, energy: 1, pulse: 1, label: "RETOUR ACCEPTÉ" },
  RECOVERY: { accent: [0.96, 0.62, 0.12], powerbankY: 0.62, powerbankTilt: 0, energy: 0.34, pulse: 0.45, label: "VÉRIFICATION" },
  ERROR: { accent: [0.96, 0.22, 0.22], powerbankY: 0.62, powerbankTilt: 0, energy: 0.18, pulse: 0.25, label: "INTERVENTION REQUISE" },
  OFFLINE: { accent: [0.46, 0.54, 0.64], powerbankY: 0.67, powerbankTilt: 0, energy: 0.12, pulse: 0.1, label: "HORS LIGNE" },
};

const VERTEX_SHADER = `
attribute vec3 aPosition;
uniform mat4 uMvp;
void main() {
  gl_Position = uMvp * vec4(aPosition, 1.0);
}
`;

const FRAGMENT_SHADER = `
precision mediump float;
uniform vec3 uColor;
uniform float uEnergy;
uniform float uPulse;
void main() {
  float rim = 0.82 + uEnergy * 0.18 + uPulse * 0.05;
  gl_FragColor = vec4(uColor * rim, 1.0);
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

function multiply(a: number[], b: number[]) {
  const out = new Array(16).fill(0);
  for (let r = 0; r < 4; r += 1) {
    for (let c = 0; c < 4; c += 1) {
      for (let k = 0; k < 4; k += 1) out[r * 4 + c] += a[r * 4 + k] * b[k * 4 + c];
    }
  }
  return out;
}

function perspective(fov: number, aspect: number, near: number, far: number) {
  const f = 1 / Math.tan(fov / 2);
  return [f / aspect,0,0,0, 0,f,0,0, 0,0,(far + near) / (near - far),-1, 0,0,(2 * far * near) / (near - far),0];
}

function modelMatrix(tx: number, ty: number, tz: number, sx: number, sy: number, sz: number, ry = 0, rz = 0) {
  const cy = Math.cos(ry), syv = Math.sin(ry), cz = Math.cos(rz), szv = Math.sin(rz);
  const rotation = [
    cy * cz, -cy * szv, syv, 0,
    szv, cz, 0, 0,
    -syv * cz, syv * szv, cy, 0,
    0,0,0,1,
  ];
  const scale = [sx,0,0,0, 0,sy,0,0, 0,0,sz,0, 0,0,0,1];
  const translate = [1,0,0,0, 0,1,0,0, 0,0,1,0, tx,ty,tz,1];
  return multiply(multiply(scale, rotation), translate);
}

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("WEBGL_SHADER_CREATE_FAILED");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || "WEBGL_SHADER_COMPILE_FAILED");
  return shader;
}

function WebGlScene({ sceneCue, reducedMotion }: Pick<Props, "sceneCue" | "reducedMotion">) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [failed, setFailed] = useState(false);
  const visual = CUE_VISUALS[sceneCue];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { alpha: true, antialias: true, powerPreference: "high-performance" });
    if (!gl) { setFailed(true); return; }

    let raf = 0;
    try {
      const program = gl.createProgram();
      if (!program) throw new Error("WEBGL_PROGRAM_CREATE_FAILED");
      gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
      gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "WEBGL_LINK_FAILED");
      gl.useProgram(program);

      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, CUBE_VERTICES, gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, "aPosition");
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 0, 0);

      const mvpLoc = gl.getUniformLocation(program, "uMvp");
      const colorLoc = gl.getUniformLocation(program, "uColor");
      const energyLoc = gl.getUniformLocation(program, "uEnergy");
      const pulseLoc = gl.getUniformLocation(program, "uPulse");

      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      const drawBox = (projection: number[], model: number[], color: [number, number, number], energy: number, pulse: number) => {
        gl.uniformMatrix4fv(mvpLoc, false, new Float32Array(multiply(model, projection)));
        gl.uniform3fv(colorLoc, new Float32Array(color));
        gl.uniform1f(energyLoc, energy);
        gl.uniform1f(pulseLoc, pulse);
        gl.drawArrays(gl.TRIANGLES, 0, CUBE_VERTICES.length / 3);
      };

      const render = (time: number) => {
        const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        const width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
        const height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
        if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
        gl.viewport(0, 0, width, height);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        const projection = perspective(Math.PI / 3.2, width / height, 0.1, 50);
        const t = reducedMotion ? 0 : time * 0.001;
        const wave = reducedMotion ? 0 : Math.sin(t * 2.1) * 0.03 * visual.pulse;
        const accent = visual.accent;

        drawBox(projection, modelMatrix(0, -0.82, -5.2, 1.55, 0.52, 1.05, -0.22, 0), [0.08, 0.11, 0.17], 0.2, 0);
        drawBox(projection, modelMatrix(0, -0.35, -4.65, 0.92, 0.16, 0.72, -0.22, 0), accent, visual.energy * 0.55, visual.pulse * 0.2);
        drawBox(
          projection,
          modelMatrix(0, visual.powerbankY - 0.45 + wave, -4.15, 0.44, 1.02, 0.22, -0.18, visual.powerbankTilt),
          [0.72 + accent[0] * 0.16, 0.76 + accent[1] * 0.1, 0.82 + accent[2] * 0.08],
          visual.energy,
          visual.pulse,
        );
        drawBox(projection, modelMatrix(0, 0.62 + wave * 0.25, -4.55, 1.18, 0.025, 0.025, 0, 0), accent, visual.energy, visual.pulse);

        if (!reducedMotion) raf = requestAnimationFrame(render);
      };

      render(0);
      if (!reducedMotion) raf = requestAnimationFrame(render);

      return () => {
        cancelAnimationFrame(raf);
        gl.deleteBuffer(buffer);
        gl.deleteProgram(program);
      };
    } catch (error) {
      console.warn("ChargeursEnergyScene WebGL fallback", error);
      setFailed(true);
    }
    return () => cancelAnimationFrame(raf);
  }, [sceneCue, reducedMotion, visual]);

  if (failed) return null;
  return <canvas ref={canvasRef} className="h-full w-full" aria-hidden="true" data-chargeurs-webgl="energy-scene" />;
}

function FallbackScene({ sceneCue, safe }: { sceneCue: ChargeursSceneCue; safe: boolean }) {
  const visual = CUE_VISUALS[sceneCue];
  const accent = `rgb(${Math.round(visual.accent[0] * 255)} ${Math.round(visual.accent[1] * 255)} ${Math.round(visual.accent[2] * 255)})`;
  return (
    <div className="relative h-full w-full overflow-hidden" aria-hidden="true" data-chargeurs-fallback={safe ? "safe" : "medium"}>
      <div className="absolute inset-x-[16%] bottom-[8%] h-[42%] rounded-[2rem] border border-white/10 bg-slate-950/90 shadow-2xl" />
      <div className="absolute inset-x-[28%] bottom-[31%] h-[8%] rounded-full blur-xl" style={{ background: accent, opacity: 0.22 }} />
      <div
        className="absolute left-1/2 h-[45%] w-[22%] -translate-x-1/2 rounded-[1.4rem] border border-white/50 bg-gradient-to-br from-slate-100 via-slate-400 to-slate-200 shadow-xl"
        style={{ bottom: `${18 + visual.powerbankY * 30}%`, transform: `translateX(-50%) rotate(${visual.powerbankTilt * 28}deg)`, transition: safe ? "none" : "bottom 420ms ease, transform 420ms ease" }}
      />
      <div className="absolute inset-x-[22%] bottom-[27%] h-[2px]" style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)`, boxShadow: `0 0 18px ${accent}` }} />
    </div>
  );
}

export function ChargeursEnergyScene({ sceneCue, renderTier, reducedMotion = false, slotNumber, className = "" }: Props) {
  const visual = useMemo(() => CUE_VISUALS[sceneCue], [sceneCue]);
  const [webglFailed, setWebglFailed] = useState(false);

  const effectiveTier = webglFailed && renderTier === "HIGH" ? "MEDIUM" : renderTier;
  const accent = `rgb(${Math.round(visual.accent[0] * 255)} ${Math.round(visual.accent[1] * 255)} ${Math.round(visual.accent[2] * 255)})`;

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
          <ErrorBoundaryFallback onFailure={() => setWebglFailed(true)}>
            <WebGlScene sceneCue={sceneCue} reducedMotion={reducedMotion} />
          </ErrorBoundaryFallback>
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

function ErrorBoundaryFallback({ children, onFailure }: { children: React.ReactNode; onFailure: () => void }) {
  useEffect(() => {
    const handle = (event: ErrorEvent) => {
      if (String(event.message || "").includes("WebGL")) onFailure();
    };
    window.addEventListener("error", handle);
    return () => window.removeEventListener("error", handle);
  }, [onFailure]);
  return <>{children}</>;
}
