import { App } from './app';
import './styles.css';

const app = new App();
app.start().catch((e) => {
  console.error(e);
  document.getElementById('page-panel')!.append(
    Object.assign(document.createElement('div'), { className: 'empty-hint', textContent: `启动失败:${(e as Error).message}` }),
  );
});
