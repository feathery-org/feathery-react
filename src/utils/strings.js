import { expandN } from 'regex-to-strings';

const startPattern = '{{ ';
const endPattern = ' }}';

const calculateCaretPosition = (
    rawCaretPos,
    selectedCaretPos,
    validIndices,
    rawFieldValue
) => {
    if (rawFieldValue.length === 0) return 0;
    else if (validIndices[rawCaretPos] === selectedCaretPos) return rawCaretPos;
    else if (selectedCaretPos > validIndices[rawCaretPos]) {
        if (rawFieldValue.length >= validIndices.length)
            return rawFieldValue.length - 1;
        else return rawFieldValue.length;
    } else if (selectedCaretPos < validIndices[rawCaretPos]) {
        while (
            selectedCaretPos < validIndices[rawCaretPos] &&
            rawCaretPos > 0
        ) {
            rawCaretPos--;
        }
        return rawCaretPos;
    }
};

const calculateArrowNavigatonCaretPos = (
    rawCaretPos,
    selectedCaretPos,
    validIndices,
    rawFieldValue
) => {
    const maskedCaretPos = selectedCaretPos;
    if (maskedCaretPos <= 0) return 0;
    else if (validIndices.indexOf(maskedCaretPos) !== -1)
        return validIndices.indexOf(maskedCaretPos);
    else return -1;
};

const escapeChars = (plainTextString) => {
    // Inorder to get the regex helper method work correctly,
    // we have to escape specials chars in the fixed part of the field mask string.
    // We are calling a custom replacer function to achieve this functionality.
    const specialChars = /[.^$*+-?()[\]}{|—/]/g;
    return plainTextString.replace(specialChars, (m) => '\\' + m);
};

function getIndicesOf(searchStr, str, caseSensitive) {
    let searchStrLen = searchStr.length;
    if (searchStrLen == 0) {
        return [];
    }
    let startIndex = 0,
        index,
        indices = [];
    if (!caseSensitive) {
        str = str.toLowerCase();
        searchStr = searchStr.toLowerCase();
    }
    while ((index = str.indexOf(searchStr, startIndex)) > -1) {
        indices.push(index);
        startIndex = index + searchStrLen;
    }
    return indices;
}

const generateRegexString = (rawPatternString, defaultSettings) => {
    let startIndex = 0;
    let fieldMaskRegex = '';
    let patternComparisionString = '';
    let patternMaskString = '';
    let rawPatternStringSlice = '';

    // Flag to indicate if the regex is deterministic or non-deterministic.
    let deterministic = true;

    // We are extracting the regex parts from the user provided mask string.
    // We will expand on the regex pattern to identify if it is a deterministic
    // pattern or a non-deterministic pattern and process accordingly.

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
    rawPatternStringSlice = rawPatternString.slice(startIndex, start);
    fieldMaskRegex += escapeChars(rawPatternStringSlice);

    // Pattern comparision string will act as a helper string duing user interaction with
    // the text field. Every keystroke will dynamically generate a new string with user input
    // injected into the generated pattern string. If the regex comparision fails,
    // we will not accept the input.
    patternComparisionString += rawPatternStringSlice;

    // This is the string which the user sees as a field mask. This gets updated as well when
    // user inputs correct value.
    patternMaskString += rawPatternStringSlice;

    fieldMaskRegex += identifiedRegex;

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

    // This block of code is needed to calculate the no.of chars the input field expects.
    // We rely on this value to correctly update the raw value which inturn updates the masked strings.
    let adjustedIndices = [];
    if (deterministic) {
        let searchString = '{!defaultChar}';
        let indices = getIndicesOf(searchString, patternComparisionString);
        adjustedIndices = indices.map(
            (i, index) => i - index * (searchString.length - 1)
        );

        searchString = '{!defaultDigit}';
        indices = getIndicesOf(searchString, patternComparisionString);
        adjustedIndices = adjustedIndices
            .concat(
                indices.map((i, index) => i - index * (searchString.length - 1))
            )
            .sort();
    } else {
        adjustedIndices = [patternComparisionString.indexOf('{}')];
    }

    // let allowedRawValueLength = (
    //     patternComparisionString.match(/\{!defaultChar\}/g) || []
    // ).length;
    // allowedRawValueLength += (
    //     patternComparisionString.match(/\{!defaultDigit\}/g) || []
    // ).length;

    // const patternCharCaretPos = patternComparisionString.indexOf(
    //     "{!defaultChar}"
    // );
    // const patternDigitCaretPos = patternComparisionString.indexOf(
    //     "{!defaultDigit}"
    // );

    // let maskedCaretPos = 0;

    // if (deterministic){
    //     if (patternCharCaretPos < patternDigitCaretPos){
    //         maskedCaretPos = patternCharCaretPos === -1 ? patternDigitCaretPos: patternCharCaretPos
    //     }
    //     else {
    //         maskedCaretPos = patternDigitCaretPos === -1 ? patternCharCaretPos: patternDigitCaretPos
    //     }
    // }
    // else maskedCaretPos = patternComparisionString.indexOf('{}');

    // if (deterministic) maskedCaretPos =

    rawPatternStringSlice = rawPatternString.substring(startIndex);
    return [
        identifiedRegex,
        fieldMaskRegex + escapeChars(rawPatternStringSlice),
        patternComparisionString + rawPatternStringSlice,
        patternMaskString + rawPatternStringSlice,
        deterministic,
        deterministic ? adjustedIndices.length : Infinity,
        adjustedIndices
    ];
};

const partialMatchRegex = function () {
    var re = this,
        source = this.source,
        i = 0;

    function process() {
        var result = '',
            tmp;

        function appendRaw(nbChars) {
            result += source.substr(i, nbChars);
            i += nbChars;
        }

        function appendOptional(nbChars) {
            result += '(?:' + source.substr(i, nbChars) + '|$)';
            i += nbChars;
        }

        while (i < source.length) {
            switch (source[i]) {
                case '\\':
                    switch (source[i + 1]) {
                        case 'c':
                            appendOptional(3);
                            break;

                        case 'x':
                            appendOptional(4);
                            break;

                        case 'u':
                            if (re.unicode) {
                                if (source[i + 2] === '{') {
                                    appendOptional(
                                        source.indexOf('}', i) - i + 1
                                    );
                                } else {
                                    appendOptional(6);
                                }
                            } else {
                                appendOptional(2);
                            }
                            break;

                        case 'p':
                        case 'P':
                            if (re.unicode) {
                                appendOptional(source.indexOf('}', i) - i + 1);
                            } else {
                                appendOptional(2);
                            }
                            break;

                        case 'k':
                            appendOptional(source.indexOf('>', i) - i + 1);
                            break;

                        default:
                            appendOptional(2);
                            break;
                    }
                    break;

                case '[':
                    tmp = /\[(?:\\.|.)*?\]/g;
                    tmp.lastIndex = i;
                    tmp = tmp.exec(source);
                    appendOptional(tmp[0].length);
                    break;

                case '|':
                case '^':
                case '$':
                case '*':
                case '+':
                case '?':
                    appendRaw(1);
                    break;

                case '{':
                    tmp = /\{\d+,?\d*\}/g;
                    tmp.lastIndex = i;
                    tmp = tmp.exec(source);
                    if (tmp) {
                        appendRaw(tmp[0].length);
                    } else {
                        appendOptional(1);
                    }
                    break;

                case '(':
                    if (source[i + 1] == '?') {
                        switch (source[i + 2]) {
                            case ':':
                                result += '(?:';
                                i += 3;
                                result += process() + '|$)';
                                break;

                            case '=':
                                result += '(?=';
                                i += 3;
                                result += process() + ')';
                                break;

                            case '!':
                                tmp = i;
                                i += 3;
                                process();
                                result += source.substr(tmp, i - tmp);
                                break;

                            case '<':
                                switch (source[i + 3]) {
                                    case '=':
                                    case '!':
                                        tmp = i;
                                        i += 4;
                                        process();
                                        result += source.substr(tmp, i - tmp);
                                        break;

                                    default:
                                        appendRaw(
                                            source.indexOf('>', i) - i + 1
                                        );
                                        result += process() + '|$)';
                                        break;
                                }
                                break;
                        }
                    } else {
                        appendRaw(1);
                        result += process() + '|$)';
                    }
                    break;

                case ')':
                    ++i;
                    return result;

                default:
                    appendOptional(1);
                    break;
            }
        }

        return result;
    }

    return new RegExp(process(), this.flags);
};

export {
    calculateCaretPosition,
    calculateArrowNavigatonCaretPos,
    escapeChars,
    generateRegexString,
    partialMatchRegex
};
