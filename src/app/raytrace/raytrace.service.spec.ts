import { TestBed } from '@angular/core/testing';
import * as THREE from 'three';
import { SceneDocument } from '../scene/scene-document';
import { DialogService } from '../ui/dialog/dialog.service';
import { RaytraceService, RaytraceView, SETTINGS_KEY, defaultRaytraceSettings } from './raytrace.service';

describe('RaytraceService', () => {
  let rt: RaytraceService;
  let dialogs: DialogService;

  function setup() {
    TestBed.configureTestingModule({ providers: [RaytraceService, SceneDocument] });
    rt = TestBed.inject(RaytraceService);
    dialogs = TestBed.inject(DialogService);
  }

  const view = (id: string): RaytraceView => ({
    id,
    title: () => id,
    container: document.createElement('div'),
    camera: new THREE.PerspectiveCamera(),
    webgl: {} as THREE.WebGLRenderer,
    background: () => '#000000',
    size: () => ({ width: 0, height: 0 }),
    requestRender: () => {},
  });

  beforeEach(() => {
    localStorage.clear();
    setup();
  });

  it('starts off with the default settings', () => {
    expect(rt.mode()).toBe('off');
    expect(rt.settings()).toEqual(defaultRaytraceSettings());
  });

  it('keeps settings in the browser, and resets them', () => {
    rt.updateSettings({ samples: 256, globalIllumination: true, toneMapping: THREE.ACESFilmicToneMapping });
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!).samples).toBe(256);

    TestBed.resetTestingModule();
    setup();
    expect(rt.settings()).toMatchObject({ samples: 256, globalIllumination: true, toneMapping: THREE.ACESFilmicToneMapping });

    rt.resetSettings();
    expect(rt.settings()).toEqual(defaultRaytraceSettings());
  });

  it('ignores saved settings of the wrong type', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ samples: 'many', shadows: 'none', workers: 9999 }));
    TestBed.resetTestingModule();
    setup();
    expect(rt.settings().samples).toBe(64);
    expect(rt.settings().shadows).toBe('none');
    expect(rt.settings().workers).toBeLessThanOrEqual(navigator.hardwareConcurrency || 4);
  });

  it('asks for a 3D view when there is none', () => {
    rt.setMode('view');
    expect(rt.mode()).toBe('off');
    expect(dialogs.current()).toMatchObject({ kind: 'message', title: 'No 3D view' });
  });

  it('lists views as they open and close, and picks the target', () => {
    rt.register(view('a'));
    rt.register(view('b'));
    expect(rt.views().map(v => v.id)).toEqual(['a', 'b']);
    rt.setTarget('b');
    expect(rt.target()).toBe('b');
    rt.unregister('b');
    expect(rt.views().map(v => v.id)).toEqual(['a']);
    expect(rt.target()).toBeNull();
  });
});
