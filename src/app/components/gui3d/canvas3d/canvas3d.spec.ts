import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Canvas3d } from './canvas3d';

describe('Canvas3d', () => {
  let component: Canvas3d;
  let fixture: ComponentFixture<Canvas3d>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Canvas3d]
    })
    .compileComponents();

    fixture = TestBed.createComponent(Canvas3d);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
