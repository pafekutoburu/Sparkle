import { Application } from '@core/application';
import { doneResponse, parseGRPCResponse } from '@core/middleware';
import { fixResponseHeaders } from '../middleware';
import { router } from './router';
import { diagnostics } from './diagnostics';

const app = new Application();

app.use(diagnostics)
    .use(doneResponse)
    .use(fixResponseHeaders)
    .use(parseGRPCResponse)
    .use(router.routes())
    .use(router.routeNotMatched());

export { app };
