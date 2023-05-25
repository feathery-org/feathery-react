export const getRawNode = (node: any) => {
  if (node.element) return node.element.getRaw();
  else if (node.model) return node.model.getRaw();
  else return node;
};
