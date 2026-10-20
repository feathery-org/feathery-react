import { defaultClient, fieldValues, setFieldValues } from '../init';
import Field from '../entities/Field';

// A logic rule (or the public setFieldValues API) that writes a field's
// current value back must not queue it for a network flush.
describe('unchanged field writes are not flushed', () => {
  beforeEach(() => {
    Object.keys(fieldValues).forEach((key) => delete fieldValues[key]);
    jest.spyOn(defaultClient, 'submitCustom').mockResolvedValue(undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    Object.keys(fieldValues).forEach((key) => delete fieldValues[key]);
  });

  describe('Field.value setter', () => {
    it('skips the flush when a primitive is set to its current value', () => {
      fieldValues.name = 'Ada';
      new Field('name', 'form').value = 'Ada';
      expect(defaultClient.submitCustom).not.toHaveBeenCalled();
    });

    it('flushes when a primitive actually changes', () => {
      fieldValues.name = 'Ada';
      new Field('name', 'form').value = 'Grace';
      expect(fieldValues.name).toBe('Grace');
      expect(defaultClient.submitCustom).toHaveBeenCalledWith({
        name: 'Grace'
      });
    });

    it('skips the flush when a repeated value is set to an equal array', () => {
      fieldValues.tags = ['a', 'b'];
      new Field('tags', 'form').value = ['a', 'b'];
      expect(defaultClient.submitCustom).not.toHaveBeenCalled();
    });

    it('flushes when a repeated value changes', () => {
      fieldValues.tags = ['a', 'b'];
      new Field('tags', 'form').value = ['a', 'c'];
      expect(defaultClient.submitCustom).toHaveBeenCalledWith({
        tags: ['a', 'c']
      });
    });

    it('still flushes an initial write of null', () => {
      new Field('name', 'form').value = null;
      expect(defaultClient.submitCustom).toHaveBeenCalledWith({ name: null });
    });
  });

  describe('Field.value proxy for repeated entries', () => {
    it('skips the flush when an entry is set to its current value', () => {
      fieldValues.tags = ['a', 'b'];
      const value = new Field('tags', 'form').value as any;
      value[1] = 'b';
      expect(defaultClient.submitCustom).not.toHaveBeenCalled();
    });

    it('flushes when an entry changes', () => {
      fieldValues.tags = ['a', 'b'];
      const value = new Field('tags', 'form').value as any;
      value[1] = 'c';
      expect(fieldValues.tags).toEqual(['a', 'c']);
      expect(defaultClient.submitCustom).toHaveBeenCalledWith({
        tags: ['a', 'c']
      });
    });
  });

  describe('Field.clear', () => {
    it('skips the flush when the field is already cleared', () => {
      fieldValues.secret = null;
      new Field('secret', 'form', true).clear();
      expect(defaultClient.submitCustom).not.toHaveBeenCalled();
    });

    it('flushes when clearing a set value', () => {
      fieldValues.secret = 'x';
      new Field('secret', 'form', true).clear();
      expect(fieldValues.secret).toBeNull();
      expect(defaultClient.submitCustom).toHaveBeenCalledWith({ secret: null });
    });
  });

  describe('setFieldValues', () => {
    it('submits only the keys whose values changed', () => {
      fieldValues.a = '1';
      fieldValues.b = ['x'];
      setFieldValues({ a: '1', b: ['x'], c: 'new' }, false);
      expect(fieldValues).toEqual({ a: '1', b: ['x'], c: 'new' });
      expect(defaultClient.submitCustom).toHaveBeenCalledWith({ c: 'new' });
    });

    it('does not submit at all when nothing changed', () => {
      fieldValues.a = '1';
      setFieldValues({ a: '1' }, false);
      expect(defaultClient.submitCustom).not.toHaveBeenCalled();
    });
  });
});
