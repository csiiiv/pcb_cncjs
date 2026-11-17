; 12mm square with 8mm circle inside
; Work origin at square corner: square 0..12 x 0..12, circle center (6,6) r=4
; Cut depth -0.100, safe Z 3.0 (PCB-style plunge/cut/retract structure)
G21 G90 G17

; --- square outline (plunge + 4 sides) ---
G0 Z3.000
G0 X0 Y0
G1 Z-0.100 F40
G1 X12 Y0 F150
G1 X12 Y12
G1 X0 Y12
G1 X0 Y0
G0 Z3.000

; --- circle, two CCW half-arcs (start at bottom, r=4 around center 6,6) ---
G0 X6 Y2
G1 Z-0.100 F40
G3 X6 Y10 I0 J4 F150
G3 X6 Y2 I0 J-4
G0 Z3.000
G0 X0 Y0
