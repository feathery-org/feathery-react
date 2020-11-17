import React from 'react';
import { Field, Label, Radio } from '@zendeskgarden/react-forms';
import {
    Dropdown,
    Item,
    Menu,
    Select,
    Field as DropdownField
} from '@zendeskgarden/react-dropdowns';
import Form from 'react-bootstrap/Form';

function DefaultDropdown({ servar, handleDropdownChange }) {
    return (
        <Dropdown
            selectedItem={servar.value}
            onSelect={handleDropdownChange(servar.id)}
        >
            <DropdownField>
                <Form.Label>{servar.name}</Form.Label>
                <br />
                <Select>{servar.value}</Select>
            </DropdownField>
            <Menu>
                {servar.metadata.options.map((option) => (
                    <Item key={option} value={option}>
                        {option}
                    </Item>
                ))}
            </Menu>
        </Dropdown>
    );
}

function DefaultRadio({ radioID, checked, value, onChange }) {
    return (
        <Field>
            <Radio
                name={radioID}
                value={value}
                checked={checked}
                onChange={onChange}
            >
                <Label>{value}</Label>
            </Radio>
        </Field>
    );
}

export { DefaultDropdown, DefaultRadio };
