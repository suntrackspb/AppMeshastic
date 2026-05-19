export default {
  name: 'ToastNotification',
  props: {
    toasts: { type: Array, required: true },
  },
  emits: ['dismiss'],
  template: `
    <div class="toast-container">
      <transition-group name="toast">
        <div
          v-for="toast in toasts"
          :key="toast.id"
          class="toast-item"
          :class="'toast-' + toast.type"
          @click="$emit('dismiss', toast.id)"
        >{{ toast.text }}</div>
      </transition-group>
    </div>
  `,
}
