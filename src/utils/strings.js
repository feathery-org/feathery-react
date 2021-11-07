import { expandN } from 'regex-to-strings';

const startPattern = '{{ ';
const endPattern = ' }}';

const escapeChars = (plainTextString) => {
    // Inorder to get the regex helper method work correctly,
    // we have to escape specials chars in the fixed part of the field mask string.
    // We are calling a custom replacer function to achieve this functionality.
    const specialChars = /[.^$*+-?()[\]}{|—/]/g;
    return plainTextString.replace(specialChars, (m) => '\\' + m);
};

const generateRegexString = (rawPatternString, defaultSettings) => {
    let startIndex = 0;
    let regexString = '';
    let patternComparisionString = '';
    let patternMaskString = '';

    // Flag to indicate if the regex is deterministic or non-deterministic.
    let deterministic = true;

    // We are extracting the regex parts from the user provided mask string.
    // We will expand on the regex pattern to identify if it is a deterministic
    // pattern or a non-deterministic pattern and process accordingly.
    while (rawPatternString.indexOf(startPattern, startIndex) >= 0) {
        // We hold the current regex part's start and end index positions to
        // perform correct string replacements.
        const start = rawPatternString.indexOf(startPattern, startIndex);
        const end = rawPatternString.indexOf(endPattern, startIndex);

        // If we do not find the right pattern for regex strings, we will return the default settings object.
        if (start === -1 || end === -1 || end <= start + startPattern.length)
            return defaultSettings;

        const identifiedRegex = rawPatternString
            .slice(start + startPattern.length, end)
            .trim();

        // We are generating the final regex string that is passed on to the TextField component.
        // Eg: User provided regex field mask is : $ {{ \\d{4} }} / year
        // We need to escape the $ which is part of the non-editable part of the field mask.
        // But $ is a special character in regex strings, so we have to perform character escaping
        // to ensure correct behavior.
        const rawPatternStringSlice = rawPatternString.slice(startIndex, start);
        regexString += escapeChars(rawPatternStringSlice);

        // Pattern comparision string will act as a helper string duing user interaction with
        // the text field. Every keystroke will dynamically generate a new string with user input
        // injected into the generated pattern string. If the regex comparision fails,
        // we will not accept the input.
        patternComparisionString += rawPatternStringSlice;

        // This is the string which the user sees as a field mask. This gets updated as well when
        // user inputs correct value.
        patternMaskString += rawPatternStringSlice;

        regexString += identifiedRegex;

        // This block of code prforms the regex expansion and tries to find if
        // the regex is a determinitic pattern or non-deterministic pattern
        const expandedStrings = expandN(identifiedRegex, 500);
        const patternComparisionSet = new Set();
        const patternMaskSet = new Set();
        for (const s of expandedStrings) {
            // We are relaying on a special react-string-format module which provides
            // python-like string format interface.With the help of this module, we are
            // able to generate dynamic strings which also supports default values
            // incase of missing attributes.
            patternComparisionSet.add(
                s
                    .replaceAll(/[a-zA-Z]/g, '{!defaultChar}')
                    .replaceAll(/\d/g, '{!defaultDigit}')
            );
            patternMaskSet.add(
                s
                    .replaceAll(/[a-zA-Z]/g, '{!defaultMaskChar}')
                    .replaceAll(/\d/g, '{!defaultMaskDigit}')
            );
        }

        // Performing checks to update the deterministic flag.
        if (patternComparisionSet.size === 1) {
            patternComparisionString += [...patternComparisionSet][0];
            patternMaskString += [...patternMaskSet][0];
        } else {
            patternComparisionString += '{}';
            patternMaskString += '{}';
            deterministic = false;
        }
        startIndex = end + endPattern.length;
    }

    // This block of code is needed to calculate the no.of chars the input field expects.
    // We rely on this value to correctly update the raw value which inturn updates the masked strings.
    let allowedRawValueLength = (
        patternComparisionString.match(/\{!defaultChar\}/g) || []
    ).length;
    allowedRawValueLength += (
        patternComparisionString.match(/\{!defaultDigit\}/g) || []
    ).length;

    const patternCharCaretPos = patternComparisionString.indexOf(
        /\{!defaultChar\}/g
    );
    const patternDigitCaretPos = patternComparisionString.indexOf(
        /\{!defaultDigit\}/g
    );
    const rawPatternStringSlice = rawPatternString.substring(startIndex);
    return [
        regexString + escapeChars(rawPatternStringSlice),
        patternComparisionString + rawPatternStringSlice,
        patternMaskString + rawPatternStringSlice,
        deterministic,
        allowedRawValueLength,
        patternCharCaretPos < patternDigitCaretPos
            ? patternCharCaretPos
            : patternDigitCaretPos
    ];
};

export { escapeChars, generateRegexString };
