import encodeGetParams from '../string';

describe('string', () => {
    describe('encodeGetParams', () => {
        it('handles well-formatted input', () => {
            // Arrange
            const params = { foo: 'bar', bar: 'foo' };
            const expected = 'foo=bar&bar=foo';

            // Act
            const actual = encodeGetParams(params);

            // Assert
            expect(actual).toEqual(expected);
        });

        it('handles poorly-formatted input', () => {
            // Arrange
            const params = {
                'hello-world': 'Hello World!',
                stuff: '©œ˜ ≈˚∆ ∑ƒ∆∂'
            };
            const expected =
                'hello-world=Hello%20World!&stuff=%C2%A9%C5%93%CB%9C%C2%A0%E2%89%88%CB%9A%E2%88%86%C2%A0%E2%88%91%C6%92%E2%88%86%E2%88%82';

            // Act
            const actual = encodeGetParams(params);

            // Assert
            expect(actual).toEqual(expected);
        });
    });
});
