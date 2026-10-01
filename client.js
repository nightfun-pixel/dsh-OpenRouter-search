/**
 * OpenRouter web-search settings card, browser half.
 *
 * Renders the search controls of `@local/dsh-openrouter-web-search` on the Settings >
 * Plugins page: the Parallel mode, the search context budget, and the result count. The
 * engine itself is fixed to Parallel and shown as a static line rather than a control.
 *
 * The card registers into the Plugins page's `plugins.item` slot only while the host serves
 * the `openrouter-web-search` settings namespace, so a deployment without the provider shows
 * no trace of it. All three fields are staged by the shared form model and written in one
 * revision-fenced save.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-openrouter-web-search',
  factory(require) {
    const React = require('react');
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives');
    const h = React.createElement;

    /** Dictionary namespace owned by this plugin. */
    const NS = 'settings.openRouterSearch';

    /** Settings namespace: the profile entry id of this bundle's row. */
    const SETTINGS_NS = 'openrouter-web-search';

    /** English copy. */
    const en = {
      title: 'OpenRouter search',
      description: 'Searches the web through OpenRouter, on the Parallel engine.',
      engine: 'Engine',
      engineValue: 'parallel (fixed)',
      engineHint: 'The search engine is fixed; change the mode below to trade latency for depth.',
      mode: 'Mode',
      modeHint: 'fast answers in about half a second; advanced trades latency for deeper search.',
      modeFast: 'fast',
      modeAdvanced: 'advanced',
      contextSize: 'Search context size',
      contextSizeHint: 'How much text the engine may return across all results.',
      contextLow: 'low',
      contextMedium: 'medium',
      contextHigh: 'high',
      maxResults: 'Results per search',
      maxResultsHint: 'A whole number from 1 to 10. The tool\u2019s own bound still caps the sources returned.',
      overridden: 'Overridden',
      reset: 'Reset to default',
      readOnly: 'This deployment stores settings read-only.',
      unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
      save: 'Save',
      saving: 'Saving\u2026',
      saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
      invalidNumber: 'Enter a whole number from 1 to 10, or leave blank to use the default.',
      invalidValue: 'Choose one of the listed values.',
    };

    /** Russian copy. */
    const ru = {
      title: 'Поиск OpenRouter',
      description: 'Ищет в интернете через OpenRouter на движке Parallel.',
      engine: 'Движок',
      engineValue: 'parallel (фиксирован)',
      engineHint: 'Движок поиска фиксирован; режим ниже переключает скорость и глубину.',
      mode: 'Режим',
      modeHint: 'fast отвечает примерно за полсекунды; advanced жертвует скоростью ради глубины.',
      modeFast: 'fast',
      modeAdvanced: 'advanced',
      contextSize: 'Объём контекста',
      contextSizeHint: 'Сколько текста движок может вернуть суммарно по всем результатам.',
      contextLow: 'low',
      contextMedium: 'medium',
      contextHigh: 'high',
      maxResults: 'Результатов на запрос',
      maxResultsHint: 'Целое число от 1 до 10. Ограничение инструмента всё равно обрежет выдачу.',
      overridden: 'Переопределено',
      reset: 'Вернуть значение по умолчанию',
      readOnly: 'В этом окружении настройки хранятся только для чтения.',
      unavailable: 'Плагин не загружен, поэтому настроить его сейчас нельзя.',
      save: 'Сохранить',
      saving: 'Сохранение\u2026',
      saveFailed: 'Окружение не приняло эти значения; они оставлены, чтобы вы их исправили.',
      invalidNumber: 'Введите целое число от 1 до 10 или оставьте пустым для значения по умолчанию.',
      invalidValue: 'Выберите одно из предложенных значений.',
    };

    /** The form frame's copy, read from this page's dictionary. */
    function formLabels(t) {
      return {
        unavailable: t('unavailable'),
        readOnly: t('readOnly'),
        saveFailed: t('saveFailed'),
        save: t('save'),
        saving: t('saving'),
      };
    }

    /** Shared styling for the native selects, so they sit beside the shipped controls. */
    const selectStyle = {
      minWidth: 160,
      padding: '4px 8px',
      borderRadius: 6,
      border: '1px solid var(--dsw-alias-border-l1)',
      background: 'var(--dsw-alias-bg-layer-1)',
      color: 'var(--dsw-alias-label-primary)',
      font: 'inherit',
    };

    const resetStyle = {
      padding: '2px 8px',
      borderRadius: 6,
      border: '1px solid var(--dsw-alias-border-l1)',
      background: 'transparent',
      color: 'var(--dsw-alias-label-secondary)',
      font: 'inherit',
      cursor: 'pointer',
    };

    /**
     * Render one labelled select over a staged settings field.
     *
     * A staged draft is text, so an unrecognized draft (which the host refuses on save) is
     * shown as a blank selection plus the invalid notice rather than being silently rewritten.
     *
     * @param props - the control's copy, its options, and its staged state and actions.
     * @returns the labelled control.
     */
    function selectField(props) {
      const { id, label, hint, options, field, disabled, t, onEdit, onReset } = props;
      const known = options.some((option) => option.value === field.text);
      return h(
        'div',
        { key: id, style: { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 } },
        h('label', { htmlFor: id, style: { fontSize: 13, fontWeight: 500, color: 'var(--dsw-alias-label-primary)' } }, label),
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
          h(
            'select',
            {
              id,
              disabled,
              value: known ? field.text : '',
              onChange: (event) => onEdit(event.target.value),
              style: selectStyle,
            },
            known ? null : h('option', { value: '' }, '\u2014'),
            options.map((option) => h('option', { key: option.value, value: option.value }, option.label)),
          ),
          field.overridden ? h('button', { type: 'button', disabled, onClick: onReset, style: resetStyle }, t('reset')) : null,
        ),
        h(
          'div',
          { style: { fontSize: 12, color: field.invalid ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-secondary)' } },
          field.invalid ? t('invalidValue') : hint,
        ),
      );
    }

    /**
     * Render the search settings card as the Plugins page asks.
     * @param props - the view asked for, locale copy, the form snapshot, and its actions.
     * @returns the one-liner, or the form.
     */
    function OpenRouterSearchCard(props) {
      const { t } = props;
      const state = props.useOpenRouterSearchCard((snapshot) => snapshot);
      if (props.view === 'summary') return t('description');
      const disabled = !state.writable;
      const shared = { t, disabled };
      return h(
        primitives.SettingsForm,
        {
          labels: formLabels(t),
          state,
          onSave: props.save,
          onDiscard: props.discard,
        },
        h(
          'div',
          { key: 'engine', style: { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 } },
          h('div', { style: { fontSize: 13, fontWeight: 500, color: 'var(--dsw-alias-label-primary)' } }, t('engine')),
          h('div', { style: { fontSize: 13, color: 'var(--dsw-alias-label-primary)' } }, t('engineValue')),
          h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, t('engineHint')),
        ),
        selectField({
          ...shared,
          id: 'or-search-mode',
          label: t('mode'),
          hint: t('modeHint'),
          options: [
            { value: 'fast', label: t('modeFast') },
            { value: 'advanced', label: t('modeAdvanced') },
          ],
          field: state.mode,
          onEdit: (value) => props.edit('mode', value),
          onReset: () => props.resetField('mode'),
        }),
        selectField({
          ...shared,
          id: 'or-search-context',
          label: t('contextSize'),
          hint: t('contextSizeHint'),
          options: [
            { value: 'low', label: t('contextLow') },
            { value: 'medium', label: t('contextMedium') },
            { value: 'high', label: t('contextHigh') },
          ],
          field: state.searchContextSize,
          onEdit: (value) => props.edit('searchContextSize', value),
          onReset: () => props.resetField('searchContextSize'),
        }),
        h(primitives.SettingsValueField, {
          key: 'maxResults',
          id: 'or-search-max-results',
          label: t('maxResults'),
          hint: t('maxResultsHint'),
          overriddenLabel: t('overridden'),
          resetLabel: t('reset'),
          invalidLabel: t('invalidNumber'),
          numeric: true,
          disabled,
          ...state.maxResults,
          onEdit: (text) => props.edit('maxResults', text),
          onReset: () => props.resetField('maxResults'),
        }),
      );
    }

    /**
     * The card's staged form over the `openrouter-web-search` settings namespace.
     *
     * All three controls live in the section, so one save writes them together and the
     * form model's revision fence covers the whole card.
     */
    class CardController {
      /**
       * @param scope - the bound settings scope for this bundle's profile entry.
       */
      constructor(scope) {
        this.form = new primitives.SettingsFormModel(scope, [
          primitives.settingsTextField('mode'),
          primitives.settingsTextField('searchContextSize'),
          primitives.settingsNumberField('maxResults'),
        ]);
        this.store = this.form.bind(() => this.projection());
      }

      /** Build the card's state from the form's current reads. */
      projection() {
        return {
          ...this.form.shell(),
          mode: this.form.field('mode'),
          searchContextSize: this.form.field('searchContextSize'),
          maxResults: this.form.field('maxResults'),
        };
      }

      /**
       * Build the face the page's slot registration injects.
       * @returns the card's snapshot and its form actions.
       */
      inject() {
        return { hooks: { openRouterSearchCard: this.store }, ...this.form.actions() };
      }

      /** Release configuration subscriptions. */
      dispose() {
        this.form.dispose();
      }
    }

    /** Required services (cordis fiber inject). */
    const inject = ['slots', 'locale', 'configForms'];

    /**
     * Mount the OpenRouter search settings card while the host serves its namespace.
     * @param ctx - the browser plugin context.
     */
    function apply(ctx) {
      const t = ctx.locale.bind(NS);
      ctx.effect(() => ctx.locale.register(NS, 'en', en), 'openrouter-web-search: dictionary (en)');
      ctx.effect(() => ctx.locale.register(NS, 'ru', ru), 'openrouter-web-search: dictionary (ru)');

      const card = new CardController(ctx.configForms.get(SETTINGS_NS));
      ctx.effect(() => () => {
        card.dispose();
      }, 'openrouter-web-search: form subscription');

      ctx.effect(
        () =>
          ctx.configForms.whileServed([SETTINGS_NS], () =>
            ctx.slots.inject('plugins.item', () =>
              ctx.slots.register(
                {
                  name: 'plugins.item',
                  id: 'openrouter-web-search',
                  order: 41,
                  label: () => t('title'),
                  locale: NS,
                  inject: () => card.inject(),
                },
                OpenRouterSearchCard,
              ),
            ),
          ),
        'openrouter-web-search: page',
      );
    }

    return { inject, apply };
  },
});
