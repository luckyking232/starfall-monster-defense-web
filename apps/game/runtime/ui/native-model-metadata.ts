interface NativeModelDescriptor {
  objects: { transforms: { name: string; localPosition: unknown }[] };
  animations: { clips: { name: string; duration: number }[] };
}

export function readNativeModelMetadata(prefab: NativeModelDescriptor) {
  const sockets = Object.fromEntries(prefab.objects.transforms.filter(({ name }) =>
    name === 'hit' || name === 'bullet' || name === 'HeadInfo').map(t => [t.name, t.localPosition]));
  const clips = prefab.animations.clips.map(clip => ({ name: clip.name, length: clip.duration }));
  return { sockets, clips };
}
