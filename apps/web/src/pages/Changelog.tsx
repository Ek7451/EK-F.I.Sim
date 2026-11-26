import Markdown from 'markdown-to-jsx/react';
import { Link } from 'react-router-dom';
import history from '../../CHANGELOG.md?raw';
import { PageHead } from '../shell/Shell';
import './help-settings.css';

export default function ChangelogPage() {
  return (
    <>
      <PageHead title="Changelog" actions={<Link to="/settings">Settings</Link>} />
      <article className="lv-card hs-release-history">
        <Markdown options={{ disableParsingRawHTML: true }}>
          {history.replace(/^# [^\r\n]*\r?\n/, '')}
        </Markdown>
      </article>
    </>
  );
}
