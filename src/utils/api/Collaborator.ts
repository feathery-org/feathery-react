/**
 * Represents a Collaborator on a form.  Part of the SDK coding model.
 */

export default class Collaborator {
  _label = '';
  _orderNumber = 0; // the index of the collaborator in the list of collaborators
  _permission = ''; // custom/all
  _permssionFields: string[] = []; // fields for custom

  constructor(
    label: string,
    orderNumber: number,
    permission: string,
    permissionFields: string[]
  ) {
    this._label = label;
    this._orderNumber = orderNumber;
    this._permission = permission;
    this._permssionFields = permissionFields;
  }

  // all properties are read-only
  get label(): string {
    return this._label;
  }

  get orderNumber(): number {
    return this._orderNumber;
  }

  get permission(): string {
    return this._permission;
  }

  get permissionFields(): string[] {
    return [...this._permssionFields];
  }
}
