import { Eye, Settings } from "lucide-react";

const defaultAccessibility = {
  enabled: false,
  fontSize: "xxlarge",
  colorScheme: "dark",
};

const fontOptions = [
  { value: "large", label: "A", title: "Крупный шрифт" },
  { value: "xlarge", label: "A", title: "Очень крупный шрифт" },
  { value: "xxlarge", label: "A", title: "Максимальный шрифт" },
];

const colorOptions = [
  { value: "light", label: "Ц", title: "Черный текст на белом фоне" },
  { value: "dark", label: "Ц", title: "Белый текст на черном фоне" },
  { value: "blue", label: "Ц", title: "Синий контраст" },
];

export function AccessibilityToolbar({ settings, onSettingsChange }) {
  const accessibility = {
    ...defaultAccessibility,
    ...(settings?.accessibility || {}),
  };

  if (!accessibility.enabled) return null;

  const updateAccessibility = (patch) => {
    onSettingsChange({
      accessibility: {
        ...accessibility,
        ...patch,
        enabled: true,
      },
    });
  };

  const disableAccessibility = () => {
    onSettingsChange({
      accessibility: {
        ...accessibility,
        enabled: false,
      },
    });
  };

  return (
    <nav className="accessibility-toolbar" aria-label="Панель режима для слабовидящих">
      <div className="accessibility-toolbar-inner">
        <div className="accessibility-toolbar-group">
          <span className="accessibility-toolbar-label">Шрифт:</span>
          {fontOptions.map((option, index) => (
            <button
              key={option.value}
              type="button"
              className={`accessibility-tool-button font-size-${index + 1} ${accessibility.fontSize === option.value ? "active" : ""}`}
              aria-pressed={accessibility.fontSize === option.value}
              title={option.title}
              onClick={() => updateAccessibility({ fontSize: option.value })}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="accessibility-toolbar-group">
          <span className="accessibility-toolbar-label">Цвет:</span>
          {colorOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`accessibility-tool-button color-scheme-${option.value} ${accessibility.colorScheme === option.value ? "active" : ""}`}
              aria-pressed={accessibility.colorScheme === option.value}
              title={option.title}
              onClick={() => updateAccessibility({ colorScheme: option.value })}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="accessibility-toolbar-group">
          <span className="accessibility-toolbar-label">Настройки:</span>
          <a className="accessibility-tool-button" href="#settings" title="Открыть настройки">
            <Settings size={18} strokeWidth={2.2} />
          </a>
        </div>

        <div className="accessibility-toolbar-group">
          <span className="accessibility-toolbar-label">Обычная версия:</span>
          <button
            type="button"
            className="accessibility-tool-button"
            title="Вернуться к обычной версии"
            onClick={disableAccessibility}
          >
            <Eye size={18} strokeWidth={2.2} />
          </button>
        </div>
      </div>
    </nav>
  );
}
