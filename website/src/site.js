const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if (!reduceMotion && 'IntersectionObserver' in window) {
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    }
  }, { threshold: 0.12 });
  document.querySelectorAll('[data-reveal]').forEach((node) => observer.observe(node));
} else {
  document.querySelectorAll('[data-reveal]').forEach((node) => node.classList.add('is-visible'));
}

const frame = document.querySelector('.hero-window');
if (frame && !reduceMotion && window.matchMedia('(pointer: fine)').matches) {
  frame.addEventListener('pointermove', (event) => {
    const rect = frame.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    frame.style.setProperty('--tilt-x', `${(-y * 2.5).toFixed(2)}deg`);
    frame.style.setProperty('--tilt-y', `${(x * 3.2).toFixed(2)}deg`);
  });
  frame.addEventListener('pointerleave', () => {
    frame.style.setProperty('--tilt-x', '0deg');
    frame.style.setProperty('--tilt-y', '0deg');
  });
}

const copy = document.querySelector('[data-copy-command]');
if (copy) {
  copy.addEventListener('click', async () => {
    const value = copy.dataset.copyCommand || '';
    try {
      await navigator.clipboard.writeText(value);
      copy.textContent = 'Copied';
      setTimeout(() => { copy.textContent = 'Copy'; }, 1400);
    } catch {
      copy.textContent = 'Select command';
    }
  });
}
