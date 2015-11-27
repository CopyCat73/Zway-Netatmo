# Zway Netatmo

Zway Automation module for the Netatmo weather station and modules. It uses the netatmo api to retrieve data at
a specified interval.

Many thanks to

    - Maroš Kollár for his code examples, parts of which I shamelessly copied
    - Fibaro forum user Couillerot for his icons

# Configuration

First go to https://dev.netatmo.com and log in with your Netatmo user account.
Create a new app for your z-way installation. Enter the client ID, client secret and
your Netatmo credentials in the configuration, along with the desired interval at which
data is retrieved (in minutes).

# Virtual Devices

Based on your Netatmo configuration the module creates virtual devices for each of your Netatmo
weather stations and attached modules. Temperature unit configuration and module names are retrieved
from the api. 

Currently supported devices are:

*   Netatmo base station (Temperature, humidity, CO2, noise and pressure)
*   Outdoor module (Temperature and humidity)
*   Additional indoor module (Temperature, humidity and CO2)
*   Rain gauge (Rain, Rain last hour and rain last 24 hours)

Please remove and install this module whenever you add or remove netatmo devices in your home. 



# License

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or any 
later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU General Public License for more details.
