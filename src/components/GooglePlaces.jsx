import React, { useEffect, useState } from 'react';
import Script from 'react-load-script';

const mapFieldTypes = new Set([
    'gmap_line_1',
    'gmap_line_2',
    'gmap_city',
    'gmap_state',
    'gmap_zip'
]);

export default function GooglePlaces({
    googleKey,
    activeStep,
    steps,
    setFieldValues,
    onChange,
    setNoChange
}) {
    const [googlePreload, setGooglePreload] = useState(false);
    const [googleLoad, setGoogleLoad] = useState(false);
    const searchField = activeStep.servar_fields.find((field) => {
        return field.servar.type === 'gmap_line_1';
    });

    useEffect(() => {
        if (searchField) setGooglePreload(true);
    }, [setGooglePreload, activeStep.key]);

    useEffect(() => {
        if (!googleLoad || !searchField) return;

        // Initialize Google Autocomplete
        /* global google */
        const autocomplete = new google.maps.places.Autocomplete(
            document.getElementById(searchField.servar.key),
            {
                componentRestrictions: { country: 'us' },
                fields: ['address_components'],
                types: ['address']
            }
        );

        const handlePlaceSelect = () => {
            // Extract City From Address Object
            const addressObject = autocomplete.getPlace();
            const address = addressObject.address_components;

            // Check if address is valid
            if (address) {
                const addressMap = {};
                address.forEach((component) => {
                    const componentType = component.types[0];

                    switch (componentType) {
                        case 'street_number': {
                            const line1 = addressMap.gmap_line_1 || '';
                            addressMap.gmap_line_1 = `${component.long_name} ${line1}`;
                            break;
                        }
                        case 'route': {
                            const line1 = addressMap.gmap_line_1 || '';
                            addressMap.gmap_line_1 = `${line1}${component.long_name}`;
                            break;
                        }
                        case 'locality': {
                            addressMap.gmap_city = component.long_name;
                            break;
                        }
                        case 'administrative_area_level_1': {
                            addressMap.gmap_state = component.long_name;
                            break;
                        }
                        case 'postal_code': {
                            addressMap.gmap_zip = component.long_name;
                            break;
                        }
                    }
                });

                const addrFieldValues = {};
                Object.values(steps).forEach((step) => {
                    step.servar_fields.forEach((field) => {
                        const servar = field.servar;
                        if (servar.type in addressMap) {
                            addrFieldValues[servar.key] =
                                addressMap[servar.type];
                        } else if (mapFieldTypes.has(servar.type)) {
                            addrFieldValues[servar.key] = '';
                        }
                    });
                });

                if (Object.keys(addrFieldValues).length > 0) {
                    let newValues;
                    // We set noChange to true to suppress onChange events from individual fields (because GMaps updates mutliple fields)
                    // Note: Re-rendering of form happens immediately after setting noChange and fieldValues
                    setNoChange(true);
                    setFieldValues((fieldValues) => {
                        newValues = { ...fieldValues, ...addrFieldValues };
                        return newValues;
                    });
                    setNoChange(false);
                    onChange(
                        Object.keys(addrFieldValues),
                        newValues,
                        'googleMaps',
                        {
                            googleMapsAddress: addressObject
                        }
                    );
                }
            }
        };

        // Fire Event when a suggested name is selected
        autocomplete.addListener('place_changed', handlePlaceSelect);
    }, [googleLoad, activeStep.key]);

    return googlePreload && googleKey ? (
        <Script
            url={`https://maps.googleapis.com/maps/api/js?key=${googleKey}&libraries=places`}
            onLoad={() => setGoogleLoad(true)}
        />
    ) : null;
}
