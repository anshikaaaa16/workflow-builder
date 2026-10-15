import { clone, uid } from './utils.js';

export const PORT_TYPES = {
  trigger: { label: 'Trigger', description: 'An event that starts the workflow' },
  flow: { label: 'Flow', description: 'Control flow: run the next step' },
  data: { label: 'Data', description: 'A value passed between nodes' },
};

export const CATEGORIES = {
  trigger: 'Triggers',
  action: 'Actions',
  logic: 'Logic',
};

const input = (key, name, dataType, maxConnections = null) =>
  ({ id: `in-${key}`, name, direction: 'in', dataType, maxConnections });

const output = (key, name, dataType) =>
  ({ id: `out-${key}`, name, direction: 'out', dataType, maxConnections: null });

export const NODE_TYPES = {
  webhook: {
    label: 'Webhook',
    category: 'trigger',
    description: 'Starts when an HTTP request arrives',
    ports: [output('fired', 'On request', 'trigger'), output('body', 'Payload', 'data')],
  },
  schedule: {
    label: 'Schedule',
    category: 'trigger',
    description: 'Starts on a timer, e.g. every hour',
    ports: [output('tick', 'On schedule', 'trigger'), output('time', 'Time', 'data')],
  },
  http: {
    label: 'HTTP Request',
    category: 'action',
    description: 'Calls an external API',
    ports: [
      input('run', 'Run', 'flow'),
      input('url', 'URL', 'data', 1),
      output('done', 'Done', 'flow'),
      output('response', 'Response', 'data'),
    ],
  },
  email: {
    label: 'Send Email',
    category: 'action',
    description: 'Sends an email',
    ports: [input('run', 'Run', 'flow'), input('body', 'Body', 'data', 1), output('sent', 'Sent', 'flow')],
  },
  transform: {
    label: 'Transform',
    category: 'action',
    description: 'Reshapes data',
    ports: [input('input', 'Input', 'data', 1), output('output', 'Output', 'data')],
  },
  delay: {
    label: 'Delay',
    category: 'action',
    description: 'Waits before continuing',
    ports: [input('run', 'Run', 'flow'), output('then', 'Then', 'flow')],
  },
  condition: {
    label: 'Condition',
    category: 'logic',
    description: 'Branches on true / false',
    ports: [
      input('run', 'Run', 'flow'),
      input('value', 'Value', 'data', 1),
      output('true', 'True', 'flow'),
      output('false', 'False', 'flow'),
    ],
  },
  merge: {
    label: 'Merge',
    category: 'logic',
    description: 'Joins two branches',
    ports: [input('a', 'Branch A', 'flow'), input('b', 'Branch B', 'flow'), output('out', 'Continue', 'flow')],
  },
};

export function createNode(type, position, id = uid('n')) {
  const def = NODE_TYPES[type];
  if (!def) throw new Error(`Unknown node type: ${type}`);
  return {
    id,
    type,
    label: def.label,
    position: { x: position.x, y: position.y },
    ports: clone(def.ports),
  };
}
