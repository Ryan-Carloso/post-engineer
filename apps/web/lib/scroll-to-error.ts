const ERROR_TARGET_SELECTOR = '[data-error-field], [aria-invalid="true"], [role="alert"]';

//---------------
// scrollToErrorField — takes the user to the first invalid field.
// The field can be the Zod path or a semantic section identifier.
//---------------
export function scrollToErrorField(field?: string): void {
  if (typeof document === 'undefined') return;

  const targets = Array.from(document.querySelectorAll<HTMLElement>(ERROR_TARGET_SELECTOR));
  const target = field
    ? targets.find((element) => element.dataset.errorField === field || element.id === field || element.getAttribute('name') === field)
    : targets[0];

  if (!target) return;

  if (typeof target.scrollIntoView === 'function') {
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  if (target.matches('input, select, textarea, button, [tabindex]:not([tabindex="-1"])')) {
    target.focus({ preventScroll: true });
    return;
  }

  target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
}
