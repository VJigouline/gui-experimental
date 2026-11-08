import { TestBed } from '@angular/core/testing';
import { PanelBus } from '../core/bus/panel-bus';
import { DialogService } from '../ui/dialog/dialog.service';
import { IFC_SETTINGS_KEY, defaultIfcSettings, readIfcSettings, writeIfcSettings } from './ifc-settings';
import { isModelFile } from './model-import';
import { ModelImportService } from './model-import.service';
import { SceneDocument } from './scene-document';

describe('IFC import settings', () => {
  beforeEach(() => localStorage.clear());

  it("start from MeerCADIFCImport's defaults and are remembered", () => {
    expect(readIfcSettings()).toEqual(defaultIfcSettings());
    writeIfcSettings({ ...defaultIfcSettings(), spaces: true, circleSegments: 48, ask: false });
    expect(readIfcSettings()).toMatchObject({ spaces: true, circleSegments: 48, ask: false });
  });

  it('ignore bad saved values and keep numbers in range', () => {
    localStorage.setItem(IFC_SETTINGS_KEY, JSON.stringify({ openings: 'yes', circleSegments: 1000, creaseAngle: -5 }));
    expect(readIfcSettings()).toMatchObject({ openings: true, circleSegments: 128, creaseAngle: 0 });
  });
});

describe('ModelImportService', () => {
  let importer: ModelImportService;
  let dialogs: DialogService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [ModelImportService, SceneDocument, PanelBus] });
    importer = TestBed.inject(ModelImportService);
    dialogs = TestBed.inject(DialogService);
  });

  it('knows the model files it reads', () => {
    expect(['a.ifc', 'B.IFC', 'c.glb', 'd.gltf', 'e.stl', 'f.obj'].every(isModelFile)).toBe(true);
    expect(isModelFile('notes.txt')).toBe(false);
  });

  it('reports files it cannot read with a Failure dialog', async () => {
    const done = importer.importFiles([new File(['x'], 'notes.txt')]);
    await Promise.resolve();
    expect(dialogs.current()).toMatchObject({ kind: 'message', title: 'Failure' });
    const r = dialogs.current();
    if (r?.kind === 'message') r.resolve();
    expect(await done).toEqual([]);
  });

  it('asks before importing IFC, and imports nothing when cancelled', async () => {
    const done = importer.importFiles([new File(['ISO-10303-21;'], 'house.ifc')]);
    await Promise.resolve();
    const r = dialogs.current();
    expect(r).toMatchObject({ kind: 'ifc-options', files: ['house.ifc'], settingsOnly: false });
    if (r?.kind === 'ifc-options') r.resolve(null);
    expect(await done).toEqual([]);
    expect(importer.busy()).toBe(false);
  });
});
