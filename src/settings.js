import { Pane } from 'tweakpane';

export function createSettings(container, initialValues, handlers) {
  const values = { ...initialValues };
  const pane = new Pane({ container });
  const tuning = pane.addFolder({ title: 'Автомобиль', expanded: true });
  tuning.addBinding(values, 'softness', { label: 'Подвеска', min: 0, max: 1, step: 0.01 })
    .on('change', () => handlers.onTuning(values));
  tuning.addBinding(values, 'grip', { label: 'Сцепление', min: 0.55, max: 1.8, step: 0.01 })
    .on('change', () => handlers.onTuning(values));
  tuning.addBinding(values, 'power', { label: 'Мощность', min: 0.5, max: 1.6, step: 0.01 })
    .on('change', () => handlers.onTuning(values));
  tuning.addButton({ title: 'Базовые настройки' }).on('click', () => handlers.onResetTuning(values, pane));

  const graphics = pane.addFolder({ title: 'Графика', expanded: true });
  graphics.addBinding(values, 'quality', { label: 'Качество', options: { Высокая: 'Высокая', 'Лёгкая': 'Лёгкая' } })
    .on('change', () => handlers.onQuality(values.quality));
  graphics.addBinding(values, 'trails', { label: 'Следы шин' })
    .on('change', () => handlers.onTrails(values.trails));

  const cityFolder = pane.addFolder({ title: 'Город', expanded: false });
  cityFolder.addBinding(values, 'roadWidth', { label: 'Ширина дорог, м', min: 12, max: 30, step: 1 })
    .on('change', event => { if (event.last) handlers.onRoadWidth(values.roadWidth); });

  const trafficFolder = pane.addFolder({ title: 'Трафик', expanded: false });
  trafficFolder.addBinding(values, 'trafficCount', { label: 'Машины', min: 0, max: 300, step: 1 })
    .on('change', event => { if (event.last) handlers.onTrafficCount(values.trafficCount); });
  trafficFolder.addBinding(values, 'trafficActual', { label: 'Активно', readonly: true, step: 1 });
  trafficFolder.addBinding(values, 'trafficPendingReason', { label: 'Очередь', readonly: true });

  if (values.debugMode) {
    const debug = pane.addFolder({ title: 'Камера debug', expanded: true });
    debug.addBinding(values, 'cameraMode', { label: 'Режим', options: { Машина: 'follow', Свободная: 'free' } })
      .on('change', () => handlers.onCameraMode(values.cameraMode));
    debug.addBinding(values, 'cameraSpeed', { label: 'Скорость, м/с', min: 2, max: 50, step: 1 })
      .on('change', () => handlers.onCameraSpeed(values.cameraSpeed));
    debug.addBinding(values, 'drawDistance', { label: 'Дальность, м', min: 100, max: 1000, step: 10 })
      .on('change', () => handlers.onDrawDistance(values.drawDistance));
    debug.addButton({ title: 'Записать дефолты' }).on('click', () => handlers.onSaveDefaults(values));
    debug.addButton({ title: 'Заводские дефолты' }).on('click', handlers.onClearDefaults);
    debug.addBinding(values, 'defaultsStatus', { label: 'Сохранение', readonly: true });
  }

  pane.addButton({ title: 'Вернуть машину' }).on('click', handlers.onReset);
  pane.refresh();
  return { pane, values };
}
