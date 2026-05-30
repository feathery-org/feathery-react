export default class AssistantClient {
  private _buttonOnClick: (button: any) => Promise<void>;
  private _runElementActions: (args: any) => Promise<any>;
  private _changeValue: (value: any, field: any, index?: number | null) => void;

  constructor(args: {
    buttonOnClick: (button: any) => Promise<void>;
    runElementActions: (args: any) => Promise<any>;
    changeValue: (value: any, field: any, index?: number | null) => void;
  }) {
    this._buttonOnClick = args.buttonOnClick;
    this._runElementActions = args.runElementActions;
    this._changeValue = args.changeValue;
  }

  click(button: any): Promise<void> {
    return this._buttonOnClick(button);
  }

  runActions(args: {
    actions: any[];
    element: any;
    elementType: 'button' | 'text' | 'container';
  }): Promise<any> {
    return this._runElementActions(args);
  }

  changeValue(value: any, field: any, index: number | null = null): void {
    this._changeValue(value, field, index);
  }
}
