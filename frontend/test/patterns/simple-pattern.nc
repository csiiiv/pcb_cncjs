; PCB test pattern — exercises G0/G1/G2/G3, plunges, retracts
; Expected: 3 cutting paths, multiple rapids, one arc
G21 G90 G17
G0 Z3.000
G0 X0 Y0

; Path 1: rectangle (plunge, 4 lines, retract)
G1 Z-0.080 F40
G1 X10 Y0 F120
G1 X10 Y10
G1 X0 Y10
G1 X0 Y0
G0 Z3.000

; Positioning rapid, then Path 2: line with arc corner
G0 X15 Y0
G1 Z-0.080 F40
G1 X25 Y0 F120
G2 X27 Y2 I0 J2
G1 X27 Y8
G0 Z3.000

; Path 3: full circle (IJ arc, two half segments)
G0 X20 Y20
G1 Z-0.080 F40
G2 X20 Y20 I-3 J0 F120
G0 Z3.000
G0 X0 Y0
