# Program Layout

- Program Blocks
  - Main [OB1] - This calls all the FC's
  - DEVICES -  - This is the group that holds all the logic for the devices themselves.
    - FB_Conveyors [FCx] - This is the FC that calls all the FB's
    - DB - This is the group that holds all the DB's
        - DB_Mot_01
        - DB_Mot_02
    - FB - This is the group that holds all the FB's
        - FB_Motor
