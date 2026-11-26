import type { UiTreeNode } from '../../runtime/ui/protocol';
import type { FguiChild } from '../fgui/package';

export function toFguiChild(node: UiTreeNode): FguiChild {
  const { children, componentId, controllers, source, transitions, ...rawDynamic } = node;
  const dynamic: Partial<typeof rawDynamic> = rawDynamic;
  const original = source as FguiChild | undefined;
  if (original?.width === undefined) delete dynamic.width;
  if (original?.height === undefined) delete dynamic.height;
  return {
    ...original,
    ...dynamic,
    ...(transitions === undefined ? {} : { transitions: transitions as NonNullable<FguiChild['transitions']> }),
    id: node.id,
    name: node.name,
    objectType: node.objectType,
    type: node.type,
    src: componentId || '',
    controllers: Object.entries(controllers).map(([name, state]) => ({ name, pages: state.pages, selected: state.selected })),
    children: children.map(toFguiChild),
  };
}
