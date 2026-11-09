import { Injectable, inject, signal } from '@angular/core';
import { PanelBus } from '../core/bus/panel-bus';
import { DialogService } from '../ui/dialog/dialog.service';
import { IfcImportSettings, readIfcSettings, writeIfcSettings } from './ifc-settings';
import { extensionOf, importModel, isModelFile, isStepFile, MODEL_EXTENSIONS } from './model-import';
import { StepImportSettings, readStepSettings, writeStepSettings } from './step-settings';
import { SceneDocument } from './scene-document';

/**
 * Imports model files into the scene from the toolbar, the File menu, the Edit Tools panel, or
 * files dropped on the workbench, as SceneEditor does:
 * - IFC and STEP files first show their import dialog, unless it is set not to ask;
 * - a busy dialog shows while files are read, as the readers run in the page;
 * - a file that can't be read shows a Failure dialog, and the others still import;
 * - warnings go to the browser console;
 * - imported models are selected and framed on a link channel.
 */
@Injectable()
export class ModelImportService {
  private readonly doc = inject(SceneDocument);
  private readonly dialogs = inject(DialogService);
  private readonly bus = inject(PanelBus);

  /** The last import's outcome, for the status bar. */
  readonly status = signal('');
  readonly busy = signal(false);

  /** Opens the STEP import dialog to change the settings without importing. */
  async editStepSettings(): Promise<void> {
    const s = await this.dialogs.stepOptions([], readStepSettings(), true);
    if (s) writeStepSettings(s);
  }

  /** Opens the IFC import dialog to change the settings without importing. */
  async editIfcSettings(): Promise<void> {
    const s = await this.dialogs.ifcOptions([], readIfcSettings(), true);
    if (s) writeIfcSettings(s);
  }

  /**
   * Imports files, selecting and framing what was imported on `channel`. Returns the new
   * objects' ids. `channel` is a channel key, as panels publish on.
   */
  async importFiles(files: readonly File[], channel = 'A'): Promise<string[]> {
    if (this.busy() || !files.length) return [];
    const unreadable = files.filter(f => !isModelFile(f.name));
    const readable = files.filter(f => isModelFile(f.name));
    if (unreadable.length) {
      await this.dialogs.message(
        'Failure',
        `${unreadable.map(f => f.name).join(', ')}: not a model this can read. Use ${MODEL_EXTENSIONS.join(', ')}.`,
      );
    }
    if (!readable.length) return [];

    let ifc: IfcImportSettings | undefined;
    const ifcFiles = readable.filter(f => extensionOf(f.name) === '.ifc');
    if (ifcFiles.length) {
      ifc = readIfcSettings();
      if (ifc.ask) {
        const chosen = await this.dialogs.ifcOptions(ifcFiles.map(f => f.name), ifc);
        if (!chosen) {
          // Cancelled: import the other files only.
          readable.splice(0, readable.length, ...readable.filter(f => !ifcFiles.includes(f)));
          if (!readable.length) return [];
        } else {
          ifc = chosen;
          writeIfcSettings(chosen);
        }
      }
    }

    let step: StepImportSettings | undefined;
    const stepFiles = readable.filter(f => isStepFile(f.name));
    if (stepFiles.length) {
      step = readStepSettings();
      if (step.ask) {
        const chosen = await this.dialogs.stepOptions(stepFiles.map(f => f.name), step);
        if (!chosen) {
          // Cancelled: import the other files only.
          readable.splice(0, readable.length, ...readable.filter(f => !stepFiles.includes(f)));
          if (!readable.length) return [];
        } else {
          step = chosen;
          writeStepSettings(chosen);
        }
      }
    }

    this.busy.set(true);
    const ids: string[] = [];
    const done: string[] = [];
    try {
      for (const file of readable) {
        this.dialogs.busy('Importing', `Reading ${file.name}…`);
        this.status.set(`Reading ${file.name}…`);
        // Let the dialog appear before a reader holds the page.
        await nextPaint();
        try {
          const model = await importModel(file, ifc, step);
          for (const w of model.warnings) console.warn(`${file.name}: ${w}`);
          ids.push(this.doc.addObject(model.object));
          done.push(model.summary ? `${file.name} (${model.summary})` : file.name);
        } catch (e) {
          this.dialogs.close();
          await this.dialogs.message('Failure', `${file.name} could not be imported.\n${(e as Error)?.message ?? String(e)}`);
        }
      }
    } finally {
      if (this.dialogs.current()?.kind === 'busy') this.dialogs.close();
      this.busy.set(false);
    }

    this.status.set(done.length ? `Imported ${done.join('; ')}` : 'Nothing imported');
    if (ids.length) {
      this.bus.publish('selection', { ids }, { channel, retain: true });
      this.bus.publish('viewport.command', { action: 'fit', ids }, { channel });
    }
    return ids;
  }
}

/** Resolves after the browser has drawn a frame. */
function nextPaint(): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
}
