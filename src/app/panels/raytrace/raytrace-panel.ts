import { Component, computed, inject, signal } from '@angular/core';
import * as THREE from 'three';
import { MAX_WORKERS, RaytraceMode, RaytraceService, RaytraceSettings, SAME_AS_VIEW, describeProgress } from '../../raytrace/raytrace.service';
import { ENVIRONMENTS, ENVIRONMENT_FILES, EnvironmentKind } from '../../raytrace/environments';
import { downloadBlob } from '../../ui/files';
import { SelectValue } from '../../ui/select-value';

/**
 * Ray tracing with MeerCADRaytracer, as on SceneEditor's Photorealistic tab: where to show the
 * image, its progress, and every setting, laid out like the workbench's other panels.
 */
@Component({
  imports: [SelectValue],
  selector: 'app-raytrace-panel',
  host: { class: 'raytrace-panel' },
  template: `
    <div class="panel-toolbar" role="toolbar" aria-label="Ray tracing">
      <button type="button" class="tool-btn" [class.on]="rt.mode() === 'view'" [attr.aria-pressed]="rt.mode() === 'view'" title="Ray trace over the 3D view (Z switches)" (click)="setMode('view')">☀ In view</button>
      <button type="button" class="tool-btn" [class.on]="rt.mode() === 'window'" [attr.aria-pressed]="rt.mode() === 'window'" title="Ray trace in a separate window" (click)="setMode('window')">⧉ Window</button>
      <button type="button" class="tool-btn" [disabled]="!rt.active()" title="Turn ray tracing off (Z switches)" (click)="setMode('off')">■ Off</button>
      <span class="tool-sep"></span>
      <button type="button" class="tool-btn" [disabled]="!rt.active()" title="Start the image again" aria-label="Start the image again" (click)="rt.restart()">↻</button>
      <button type="button" class="tool-btn" [disabled]="!rt.active() || rt.progress().done || rt.progress().stopped" title="Stop tracing" aria-label="Stop tracing" (click)="rt.stop()">⏹</button>
      <button type="button" class="tool-btn" [disabled]="!rt.active()" title="Save the image as PNG" aria-label="Save image" (click)="save()">⇩</button>
    </div>

    <form class="props" (submit)="$event.preventDefault()">
      <fieldset>
        <legend>Show</legend>
        <label class="field">
          <span>Image</span>
          <select class="input" [appSelectValue]="rt.mode()" (change)="setMode($any($event.target).value)">
            @for (o of modeOptions; track o.value) {
              <option [value]="o.value">{{ o.name }}</option>
            }
          </select>
        </label>
        <label class="field">
          <span>3D view</span>
          <select class="input" [appSelectValue]="targetId()" [disabled]="!rt.views().length" (change)="rt.setTarget($any($event.target).value)">
            @for (v of rt.views(); track v.id) {
              <option [value]="v.id">{{ v.title() }}</option>
            } @empty {
              <option value="">No 3D view open</option>
            }
          </select>
        </label>
        <p class="hint">Press Z in a 3D view to switch between it and its ray traced image.</p>
        @if (rt.active()) {
          <div class="trace-progress" [class.error]="!!rt.progress().error">
            <span>{{ status() }}</span>
            <progress [max]="rt.progress().maxSamples || 1" [value]="rt.progress().samples"></progress>
          </div>
        }
      </fieldset>

      <fieldset>
        <legend>Quality</legend>
        <label class="field">
          <span>Samples</span>
          <select class="input" [appSelectValue]="s().samples" (change)="set({ samples: +value($event) })">
            @for (o of sampleOptions; track o) {
              <option [value]="'' + o">{{ o }} per pixel</option>
            }
          </select>
        </label>
        <label class="field">
          <span>Bounces</span>
          <span class="range"><input type="range" min="0" max="16" step="1" [value]="s().maxBounces" (input)="set({ maxBounces: +value($event) })" /><output>{{ s().maxBounces }}</output></span>
        </label>
        <label class="field">
          <span>Resolution</span>
          <select class="input" [appSelectValue]="s().resolution" (change)="set({ resolution: +value($event) })">
            @for (o of resolutionOptions; track o.value) {
              <option [value]="'' + o.value">{{ o.name }}</option>
            }
          </select>
        </label>
        <label class="field">
          <span>Preview</span>
          <select class="input" [appSelectValue]="s().previewBlock" (change)="set({ previewBlock: +value($event) })">
            @for (o of previewOptions; track o.value) {
              <option [value]="'' + o.value">{{ o.name }}</option>
            }
          </select>
        </label>
        <label class="field">
          <span>Threads</span>
          <span class="range"><input type="range" min="1" [max]="maxWorkers" step="1" [value]="s().workers" (input)="set({ workers: +value($event) })" /><output>{{ s().workers }}</output></span>
        </label>
      </fieldset>

      <fieldset>
        <legend>Lighting</legend>
        <label class="field">
          <span>Shadows</span>
          <select class="input" [appSelectValue]="s().shadows" (change)="set({ shadows: $any(value($event)) })">
            @for (o of shadowOptions; track o.value) {
              <option [value]="o.value">{{ o.name }}</option>
            }
          </select>
        </label>
        <label class="field" title="Light also bounces off ordinary surfaces. Needs 256 samples or more.">
          <span>Global illum.</span>
          <input type="checkbox" [checked]="s().globalIllumination" (change)="set({ globalIllumination: checked($event) })" />
        </label>
      </fieldset>

      <fieldset class="environment-settings">
        <legend>Environment</legend>
        <label class="field" [title]="environmentAbout()">
          <span>Around</span>
          <select class="input" [appSelectValue]="s().environment" (change)="setEnvironment($event, envFile)">
            @for (e of environments; track e.kind) {
              <option [value]="e.kind" [title]="e.about">{{ e.kind === 'file' && rt.environmentFile() ? rt.environmentFile()!.name : e.label }}</option>
            }
          </select>
        </label>
        <input #envFile type="file" hidden [accept]="environmentFiles" (change)="loadEnvironment($event)" />
        @if (rt.environmentPreview(); as src) {
          <img class="environment-preview" [src]="src" alt="The environment, all round, as one picture" />
        }
        @if (s().environment !== 'none') {
          <label class="field" title="How bright the environment is, in reflections and as light">
            <span>Intensity</span>
            <span class="range"><input type="range" min="0" max="3" step="0.05" [value]="s().environmentIntensity" (input)="set({ environmentIntensity: +value($event) })" /><output>{{ s().environmentIntensity }}</output></span>
          </label>
          <label class="field" title="Turns the environment round the vertical axis, to move its lights and sun">
            <span>Rotation °</span>
            <span class="range"><input type="range" min="-180" max="180" step="5" [value]="s().environmentRotation" (input)="set({ environmentRotation: +value($event) })" /><output>{{ s().environmentRotation }}</output></span>
          </label>
          <label class="field">
            <span>Background</span>
            <span class="check"><input type="checkbox" [checked]="s().environmentBackground" (change)="set({ environmentBackground: checked($event) })" /> Show behind the scene</span>
          </label>
          <button type="button" class="btn" (click)="envFile.click()">Load .hdr, .exr or image…</button>
        }
        @if (envError()) {
          <p class="hint">{{ envError() }}</p>
        } @else if (s().environment === 'file' && !rt.environmentFile()) {
          <p class="hint">Choose a file to use.</p>
        }
      </fieldset>

      <fieldset>
        <legend>Image</legend>
        <label class="field">
          <span>Tone mapping</span>
          <select class="input" [appSelectValue]="s().toneMapping" (change)="setToneMapping(value($event))">
            @for (o of toneMappingOptions; track o.value) {
              <option [value]="'' + o.value">{{ o.name }}</option>
            }
          </select>
        </label>
        <label class="field">
          <span>Exposure</span>
          <span class="range"><input type="range" min="0" max="4" step="0.05" [disabled]="!exposureApplies()" [value]="s().exposure" (input)="set({ exposure: +value($event) })" /><output>{{ s().exposure }}</output></span>
        </label>
        <label class="field">
          <span>Colour space</span>
          <select class="input" [appSelectValue]="s().colorSpace" (change)="set({ colorSpace: value($event) })">
            @for (o of colorSpaceOptions; track o.value) {
              <option [value]="o.value">{{ o.name }}</option>
            }
          </select>
        </label>
        <label class="field">
          <span>Background</span>
          <select class="input" [appSelectValue]="s().background" (change)="set({ background: $any(value($event)) })">
            <option value="view">As the 3D view</option>
            <option value="colour">Colour</option>
          </select>
        </label>
        @if (s().background === 'colour') {
          <label class="field">
            <span>Colour</span>
            <input type="color" [value]="s().backgroundColour" (input)="set({ backgroundColour: value($event) })" />
          </label>
        }
        <label class="field" title="In the separate window, show the 3D view's proportions instead of stretching to the window.">
          <span>Proportions</span>
          <span class="check"><input type="checkbox" [checked]="s().keepProportions" (change)="set({ keepProportions: checked($event) })" /> Keep in the window</span>
        </label>
      </fieldset>

      <div class="dialog-buttons">
        <button type="button" class="btn" (click)="rt.resetSettings()">Reset settings</button>
      </div>
      @if (saveError()) {
        <p class="hint">{{ saveError() }}</p>
      }
    </form>
  `,
})
export class RaytracePanel {
  protected readonly rt = inject(RaytraceService);
  protected readonly s = this.rt.settings;
  protected readonly maxWorkers = MAX_WORKERS;
  protected readonly saveError = signal('');
  protected readonly envError = signal('');
  protected readonly environments = ENVIRONMENTS;
  protected readonly environmentFiles = ENVIRONMENT_FILES;
  protected readonly environmentAbout = computed(() => ENVIRONMENTS.find(e => e.kind === this.s().environment)?.about ?? '');

  protected readonly modeOptions: { value: RaytraceMode; name: string }[] = [
    { value: 'off', name: 'Off (WebGL only)' },
    { value: 'view', name: 'Over the 3D view' },
    { value: 'window', name: 'In a separate window' },
  ];
  protected readonly sampleOptions = [1, 4, 16, 64, 256, 1024, 4096];
  protected readonly resolutionOptions = [
    { value: 0.25, name: 'Quarter (fastest)' },
    { value: 0.5, name: 'Half' },
    { value: 1, name: 'Full screen resolution' },
  ];
  protected readonly previewOptions = [
    { value: 1, name: 'None' },
    { value: 2, name: 'Fine (2 × 2 blocks)' },
    { value: 4, name: 'Normal (4 × 4 blocks)' },
    { value: 8, name: 'Coarse (8 × 8 blocks)' },
  ];
  protected readonly shadowOptions = [
    { value: 'all', name: 'All lights and objects' },
    { value: 'castShadow', name: 'As three.js: castShadow' },
    { value: 'none', name: 'None' },
  ];
  protected readonly toneMappingOptions = [
    { value: SAME_AS_VIEW, name: 'As the 3D view' },
    { value: THREE.NoToneMapping, name: 'None' },
    { value: THREE.LinearToneMapping, name: 'Linear' },
    { value: THREE.ReinhardToneMapping, name: 'Reinhard' },
    { value: THREE.CineonToneMapping, name: 'Cineon' },
    { value: THREE.ACESFilmicToneMapping, name: 'ACES Filmic' },
    { value: THREE.AgXToneMapping, name: 'AgX' },
    { value: THREE.NeutralToneMapping, name: 'Neutral' },
  ];
  protected readonly colorSpaceOptions = [
    { value: SAME_AS_VIEW, name: 'As the 3D view' },
    { value: THREE.SRGBColorSpace, name: 'sRGB' },
    { value: THREE.LinearSRGBColorSpace, name: 'Linear sRGB' },
  ];

  protected readonly targetId = computed(() => this.rt.target() ?? this.rt.views()[0]?.id ?? '');
  protected readonly status = computed(() => describeProgress(this.rt.progress()));
  /** Exposure only matters with tone mapping. The views draw without it. */
  protected readonly exposureApplies = computed(() => {
    const t = this.s().toneMapping;
    return t !== SAME_AS_VIEW && t !== THREE.NoToneMapping;
  });

  protected setMode(mode: RaytraceMode): void {
    this.rt.setMode(mode, this.targetId() || undefined);
  }

  protected set(patch: Partial<RaytraceSettings>): void {
    this.rt.updateSettings(patch);
  }

  /** Chooses an environment; From a file asks for one when none is loaded. */
  protected setEnvironment(event: Event, input: HTMLInputElement): void {
    const select = event.target as HTMLSelectElement;
    const kind = select.value;
    this.envError.set('');
    if (kind === 'file' && !this.rt.environmentFile()) {
      // Until one is loaded, the choice stays as it was.
      select.value = this.s().environment;
      input.click();
      return;
    }
    this.set({ environment: kind as EnvironmentKind });
  }

  protected async loadEnvironment(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.envError.set((await this.rt.loadEnvironment(file)) ?? '');
  }

  protected setToneMapping(v: string): void {
    this.set({ toneMapping: v === SAME_AS_VIEW ? SAME_AS_VIEW : +v });
  }

  protected async save(): Promise<void> {
    const blob = await this.rt.image();
    if (blob) {
      downloadBlob(blob, 'raytraced.png');
      this.saveError.set('');
    } else {
      this.saveError.set('There is no image to save yet.');
    }
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected checked(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }
}
