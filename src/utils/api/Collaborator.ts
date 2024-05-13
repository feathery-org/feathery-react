/**
 * Represents a Collaborator on a form.  Part of the SDK coding model.
 */

export default class Collaborator {
  _role = '';
  _orderNumber = 0; // the index of the collaborator in the list of collaborators
  _permission = ''; // custom/all
  _permssionFields: string[] = []; // fields for custom

  constructor(
    role: string,
    orderNumber: number,
    permission: string,
    permissionFields: string[]
  ) {
    this._role = role;
    this._orderNumber = orderNumber;
    this._permission = permission;
    this._permssionFields = permissionFields;
  }

  // all properties are read-only
  get role(): string {
    return this._role;
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
