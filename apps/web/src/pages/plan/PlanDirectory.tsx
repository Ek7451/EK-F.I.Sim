import { Icon } from '@fisim/ui';
import { Link } from 'react-router-dom';
import { NAV } from '../../shell/nav';
import { PageHead } from '../../shell/Shell';

export function PlanDirectory() {
  const sections = NAV.find((group) => group.id === 'plan')!.items;
  return (
    <>
      <PageHead title="Edit plan" />
      <nav aria-label="Plan inputs" className="plan-directory">
        {sections.map((section) => (
          <Link key={section.to} to={section.to}>
            <Icon name={section.icon} size={20} />
            <span>
              <strong>{section.label}</strong>
              <small>{section.description}</small>
            </span>
            <Icon name="chevron" size={16} />
          </Link>
        ))}
      </nav>
    </>
  );
}
