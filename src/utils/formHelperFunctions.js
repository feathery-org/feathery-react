function adjustColor(color, amount) {
    return (
        '#' +
        color
            .replace(/^#/, '')
            .replace(/../g, (color) =>
                (
                    '0' +
                    Math.min(
                        255,
                        Math.max(0, parseInt(color, 16) + amount)
                    ).toString(16)
                ).substr(-2)
            )
    );
}

const calculateDimensionsHelper = (
    dimensions,
    setDimensions,
    setFormDimensions
) => (inputStep) => {
    const gridTemplateRows = inputStep.grid_rows.map(
        (row) => `minmax(${row},min-content)`
    );

    let gridTemplateColumns;
    if (window.innerWidth >= 768) {
        gridTemplateColumns = inputStep.grid_columns;
    } else {
        const seenColumns = new Set();
        if (inputStep.progress_bar)
            seenColumns.add(inputStep.progress_bar.column_index);
        inputStep.text_fields.map((field) =>
            seenColumns.add(field.column_index)
        );
        inputStep.servar_fields.map((field) =>
            seenColumns.add(field.column_index)
        );
        gridTemplateColumns = inputStep.grid_columns.map((c, index) =>
            seenColumns.has(index) ? c : '10px'
        );
    }

    let definiteWidth = 0;
    gridTemplateColumns.forEach((column) => {
        if (definiteWidth !== null && column.slice(-2) === 'px') {
            definiteWidth += parseFloat(column);
        } else {
            definiteWidth = null;
        }
    });
    if (definiteWidth) {
        gridTemplateColumns = gridTemplateColumns.map(
            (c) => `${(100 * parseFloat(c)) / definiteWidth}%`
        );
    }

    const newDimensions = {
        width: definiteWidth,
        columns: gridTemplateColumns,
        rows: gridTemplateRows
    };
    if (JSON.stringify(newDimensions) !== JSON.stringify(dimensions)) {
        setDimensions(newDimensions);
        setFormDimensions(definiteWidth, gridTemplateColumns, gridTemplateRows);
    }
};

const setFieldValues = (data, fieldValues = {}) => {
    data.forEach((step) => {
        step.servar_fields.forEach((field) => {
            const servar = field.servar;
            if (servar.key in fieldValues) {
                servar.value = fieldValues[servar.key];
            } else {
                switch (servar.type) {
                    case 'checkbox':
                        servar.value = false;
                        break;
                    case 'multiselect':
                        servar.value = [];
                        break;
                    case 'integer_field':
                        servar.value = 0;
                        break;
                    case 'hex_color':
                        servar.value = '000000';
                        break;
                    default:
                        servar.value = '';
                        break;
                }
            }
        });
    });
};

export { adjustColor, calculateDimensionsHelper, setFieldValues };
