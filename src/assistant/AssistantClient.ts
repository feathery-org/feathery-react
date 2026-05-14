export default class AssistantClient {
  private _buttonOnClick: (button: any) => Promise<void>;
  private _runElementActions: (args: any) => Promise<any>;

  constructor(args: {
    buttonOnClick: (button: any) => Promise<void>;
    runElementActions: (args: any) => Promise<any>;
  }) {
    this._buttonOnClick = args.buttonOnClick;
    this._runElementActions = args.runElementActions;
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
}
