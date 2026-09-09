type Step = 'connect' | 'import' | 'review' | 'publish' | 'view';

const steps: Array<{ id: Step; label: string; href: string }> = [
  { id: 'connect', label: 'Kaynak bağla', href: '/dashboard/connections' },
  { id: 'import', label: 'Veri aktar', href: '/dashboard/imports' },
  { id: 'review', label: 'Kontrol et', href: '/dashboard/products' },
  { id: 'publish', label: 'Yayımla', href: '/dashboard/products' },
  { id: 'view', label: 'Mağazanı görüntüle', href: '/' },
];

export function OnboardingSteps({
  current,
  completed = [],
}: {
  current: Step;
  completed?: Step[];
}) {
  return (
    <nav className="onboarding-steps" aria-label="Mağaza kurulum adımları">
      <ol>
        {steps.map((step, index) => {
          const done = completed.includes(step.id);
          return (
            <li
              key={step.id}
              className={step.id === current ? 'current' : done ? 'done' : ''}
            >
              <a
                href={step.href}
                aria-current={step.id === current ? 'step' : undefined}
              >
                <span>{done ? '✓' : index + 1}</span>
                {step.label}
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
