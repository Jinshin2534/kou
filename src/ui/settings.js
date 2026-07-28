const FONTS = [
  { value: 'mincho', label: '明朝', css: "'Hiragino Mincho ProN', 'Yu Mincho', 'Noto Serif JP', serif" },
  { value: 'gothic', label: 'ゴシック', css: "'Hiragino Sans', 'Yu Gothic', 'Noto Sans JP', sans-serif" },
  { value: 'mono', label: '等幅', css: "'SFMono-Regular', 'Consolas', monospace" },
];

const THEMES = [
  { value: 'light', label: '白' },
  { value: 'sepia', label: 'セピア' },
  { value: 'dark', label: '黒' },
];

export function applySettings(settings) {
  const font = FONTS.find((f) => f.value === settings.fontFamily) ?? FONTS[0];
  const root = document.documentElement;
  root.style.setProperty('--kou-editor-font', font.css);
  root.style.setProperty('--kou-editor-size', `${settings.fontSize}px`);
  root.style.setProperty('--kou-editor-line', String(settings.lineHeight));
  root.style.setProperty('--kou-editor-spacing', `${settings.letterSpacing}em`);
  // Primer の明暗は data-color-mode が決める。ここを書き換えないと、
  // 「白」「黒」を選んでも OS の設定のままで何も起きない。
  root.dataset.colorMode = settings.theme === 'dark' ? 'dark' : 'light';
  root.dataset.theme = settings.theme;
}

export function renderSettings({ state, data, actions }) {
  const settings = data.work.settings;

  const root = document.createElement('div');
  root.className = 'settings';

  const back = document.createElement('button');
  back.textContent = '執筆に戻る';
  back.addEventListener('click', () => actions.setScreen('write'));
  root.append(back);

  root.append(
    choice('書体', FONTS, settings.fontFamily, (v) => actions.updateSettings({ fontFamily: v })),
    range('文字サイズ', settings.fontSize, 12, 28, 1, 'px', (v) =>
      actions.updateSettings({ fontSize: v }),
    ),
    range('行間', settings.lineHeight, 1.4, 3, 0.1, '', (v) =>
      actions.updateSettings({ lineHeight: v }),
    ),
    range('字間', settings.letterSpacing, 0, 0.3, 0.01, 'em', (v) =>
      actions.updateSettings({ letterSpacing: v }),
    ),
    range('1行あたりの字数（枚数計算用）', settings.charsPerLine, 10, 40, 1, '字', (v) =>
      actions.updateSettings({ charsPerLine: v }),
    ),
    choice('テーマ', THEMES, settings.theme, (v) => actions.updateSettings({ theme: v })),
  );

  const preview = document.createElement('div');
  preview.className = 'settings__preview';
  preview.textContent =
    '改札を抜けると、雨の匂いがした。傘を持たない人々が軒下に固まって、一様に空を見上げている。';
  root.append(preview);

  return root;
}

function field(label) {
  const wrap = document.createElement('div');
  wrap.className = 'settings__field';
  const name = document.createElement('span');
  name.className = 'settings__label';
  name.textContent = label;
  wrap.append(name);
  return wrap;
}

function choice(label, options, current, onChange) {
  const wrap = field(label);
  const group = document.createElement('div');
  group.className = 'settings__choice';
  for (const option of options) {
    const b = document.createElement('button');
    b.textContent = option.label;
    b.className = option.value === current ? 'is-current' : '';
    b.addEventListener('click', () => onChange(option.value));
    group.append(b);
  }
  wrap.append(group);
  return wrap;
}

function range(label, current, min, max, step, unit, onChange) {
  const wrap = field(label);
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(current);
  const out = document.createElement('span');
  out.className = 'settings__value';
  out.textContent = `${current}${unit}`;
  input.addEventListener('input', () => {
    out.textContent = `${input.value}${unit}`;
  });
  input.addEventListener('change', () => onChange(Number(input.value)));
  wrap.append(input, out);
  return wrap;
}
