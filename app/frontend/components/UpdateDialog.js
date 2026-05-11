export default {
  props: ['version'],
  emits: ['close'],

  data() {
    return { installing: false, error: null }
  },

  methods: {
    async install() {
      this.installing = true
      this.error = null
      try {
        await window.pywebview.api.apply_update()
      } catch (e) {
        this.error = 'Ошибка при обновлении. Попробуйте позже.'
        this.installing = false
      }
    },
  },

  template: `
    <div class="dialog-overlay">
      <div class="dialog" style="width:360px">
        <div class="dialog-header">
          <span>Доступно обновление</span>
          <button class="icon-btn" @click="$emit('close')" :disabled="installing">✕</button>
        </div>
        <div class="dialog-body" style="gap:12px">
          <p style="margin:0">Вышла новая версия <strong>{{ version }}</strong>.<br>Приложение обновится и перезапустится автоматически.</p>
          <p v-if="error" style="margin:0;color:var(--color-error, #ff6b6b)">{{ error }}</p>
        </div>
        <div class="dialog-footer">
          <button class="btn-secondary" @click="$emit('close')" :disabled="installing">Позже</button>
          <button class="btn-primary" @click="install" :disabled="installing">
            {{ installing ? 'Обновляю...' : 'Обновить' }}
          </button>
        </div>
      </div>
    </div>
  `,
}
